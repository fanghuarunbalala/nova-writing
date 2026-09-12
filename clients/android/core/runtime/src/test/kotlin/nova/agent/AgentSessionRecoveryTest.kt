package nova.agent

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import nova.agent.journal.JsonlJournalStore
import nova.agent.loop.AgentLoopConfig
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.ToolCall
import nova.agent.provider.FakeProvider
import nova.agent.session.AgentSession
import nova.agent.tool.novel.InMemoryNovelStore
import nova.agent.tool.novel.novelTools
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 崩溃恢复可见化（M4 阶段3 runtime 扩展②）：
 * start() 内 settlePendingRun 补完非空 → onRecovered(悬挂 ToolCall 列表) 回调。
 */
class AgentSessionRecoveryTest {

    private fun pendingCall() = ToolCall(
        "t-1", "novel_write_paragraph",
        """{"id":"p-9","storyUnitId":"u1","orderKey":1,"text":"雪落了满肩。"}""",
    )

    @Test
    fun startSettlesPendingToolCallsAndInvokesOnRecovered() = runTest {
        val dir = Files.createTempDirectory("nova-recover")
        val path = dir.resolve("journal.jsonl")
        // 预置悬挂：run 1 的 assistant 发起 toolCall 后无 tool 回填（模拟重启前中断）
        val seed = JsonlJournalStore(path, io = StandardTestDispatcher(testScheduler))
        seed.open()
        seed.appendSnapshot(
            1,
            listOf(
                LLMessage.User("续写"),
                LLMessage.Assistant(
                    content = "调用工具",
                    toolCalls = listOf(pendingCall()),
                    finishReason = FinishReason.TOOL_CALL,
                ),
            ),
        )
        seed.close()

        val provider = FakeProvider().apply { enqueueText("重启后的回答") }
        val recovered = mutableListOf<List<ToolCall>>()
        val session = AgentSession(
            conversationId = "c1",
            provider = provider,
            tools = novelTools(InMemoryNovelStore()),
            journal = JsonlJournalStore(path, io = StandardTestDispatcher(testScheduler)),
            loopConfig = AgentLoopConfig(approvalBypass = true),
            dispatcher = StandardTestDispatcher(testScheduler),
            clock = { currentTime },
            onRecovered = { recovered += it },
        )
        session.start()
        advanceUntilIdle()

        assertEquals(1, recovered.size)
        assertEquals(listOf("t-1"), recovered[0].map { it.id })
        // 补完的 tool 回填已落 journal
        val history = session.history()
        assertTrue(history[0].messages.any { it is LLMessage.Tool && it.toolCallId == "t-1" })
        session.shutdown()
    }

    @Test
    fun cleanJournalMeansNoRecoveryCallback() = runTest {
        val dir = Files.createTempDirectory("nova-clean")
        val path = dir.resolve("journal.jsonl")
        val seed = JsonlJournalStore(path, io = StandardTestDispatcher(testScheduler))
        seed.open()
        seed.appendSnapshot(1, listOf(LLMessage.User("你好"), LLMessage.Assistant(content = "在")))
        seed.close()

        val session = AgentSession(
            conversationId = "c1",
            provider = FakeProvider(),
            tools = novelTools(InMemoryNovelStore()),
            journal = JsonlJournalStore(path, io = StandardTestDispatcher(testScheduler)),
            loopConfig = AgentLoopConfig(approvalBypass = true),
            dispatcher = StandardTestDispatcher(testScheduler),
            clock = { currentTime },
            onRecovered = { error("干净 journal 不应触发恢复回调") },
        )
        session.start()
        advanceUntilIdle()
        assertEquals(1, session.history().size)
        session.shutdown()
    }
}
