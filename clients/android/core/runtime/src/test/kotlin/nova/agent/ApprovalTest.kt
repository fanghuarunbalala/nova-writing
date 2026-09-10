package nova.agent

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalRequest
import nova.agent.loop.AgentLoopConfig
import nova.agent.loop.RunEndReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.provider.FakeProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ApprovalTest {

    private fun writeCall() = FakeProvider.toolCall(
        "c1", "novel_write_paragraph",
        arguments = """{"id":"p-1","storyUnitId":"su-12","orderKey":1,"text":"林深推开门，雪落了满肩。","baseRevision":1}""",
    )

    private fun harness(
        onRequest: suspend (ApprovalRequest) -> Unit,
        timeoutMs: Long = 120_000,
        clock: () -> Long = { 0L },
    ) = LoopHarness(
        FakeProvider.ScriptedTurn(deltas = listOf("我来写入"), toolCalls = listOf(writeCall())),
        FakeProvider.ScriptedTurn(deltas = listOf("已按批准写入")),
        loopConfig = AgentLoopConfig(approvalBypass = false),
        approvalTimeoutMs = timeoutMs,
        onRequest = onRequest,
        clock = clock,
    )

    @Test
    fun approveExecutesTool() = runTest {
        val request = CompletableDeferred<ApprovalRequest>()
        val h = harness(onRequest = { request.complete(it) }, clock = { currentTime })
        h.journal.open()
        h.store.write("p-1", "su-0", 0, "旧段落占位", baseRevision = null) // v1

        val runs = mutableListOf<StoredRun>()
        val job = launch { h.loop().executeRun(1, "续写", runs) }
        val req = request.await()
        assertEquals(listOf("novel_write_paragraph"), req.calls.map { it.name })
        assertEquals("approval:c-test:1:b0", req.requestId)

        h.gate.resolve(req.requestId, ApprovalDecision.Approve)
        job.join()

        val toolMsg = assertIs<LLMessage.Tool>(runs[0].messages[2])
        assertTrue(toolMsg.content.contains("已写入段落 p-1（v2"))
        assertEquals("林深推开门，雪落了满肩。", h.store.get("p-1")?.text)
        val final = assertIs<LLMessage.Assistant>(runs[0].messages[3])
        assertEquals("已按批准写入", final.content)
    }

    @Test
    fun rejectSkipsToolAndFeedsBackComment() = runTest {
        val request = CompletableDeferred<ApprovalRequest>()
        val h = harness(onRequest = { request.complete(it) }, clock = { currentTime })
        h.journal.open()
        h.store.write("p-1", "su-0", 0, "旧段落占位", baseRevision = null)

        val runs = mutableListOf<StoredRun>()
        val job = launch { h.loop().executeRun(1, "续写", runs) }
        val req = request.await()
        h.gate.resolve(req.requestId, ApprovalDecision.Reject("这段打斗太突兀，先铺垫"))

        job.join()

        val toolMsg = assertIs<LLMessage.Tool>(runs[0].messages[2])
        assertTrue(toolMsg.isError)
        assertEquals("用户已拒绝该工具调用：这段打斗太突兀，先铺垫", toolMsg.content)
        // 拒绝 = 不执行：正文未被改写
        assertEquals("旧段落占位", h.store.get("p-1")?.text)
        // 拒绝文本落 journal（决策可恢复——桌面端缺陷的修复点）
        assertTrue(h.journalText().contains("用户已拒绝该工具调用"))
    }

    @Test
    fun timeoutTreatedAsReject() = runTest {
        val seen = CompletableDeferred<ApprovalRequest>()
        val h = harness(onRequest = { seen.complete(it) }, timeoutMs = 100, clock = { currentTime })
        h.journal.open()
        h.store.write("p-1", "su-0", 0, "旧段落占位", baseRevision = null)

        val runs = mutableListOf<StoredRun>()
        val job = launch { h.loop().executeRun(1, "续写", runs) }
        seen.await()
        advanceTimeBy(200) // 虚拟时钟跳过超时窗口
        job.join()

        val toolMsg = assertIs<LLMessage.Tool>(runs[0].messages[2])
        assertTrue(toolMsg.content.contains("审批超时"))
        assertEquals("旧段落占位", h.store.get("p-1")?.text)
    }
}
