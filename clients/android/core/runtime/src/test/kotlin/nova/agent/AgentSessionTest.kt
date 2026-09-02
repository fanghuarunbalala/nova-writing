package nova.agent

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalGate
import nova.agent.approval.ApprovalRequest
import nova.agent.journal.JsonlJournalStore
import nova.agent.loop.AgentLoopConfig
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.LLMessage
import nova.agent.provider.FakeProvider
import nova.agent.session.AgentSession
import nova.agent.session.SessionState
import nova.agent.tool.novel.InMemoryNovelStore
import nova.agent.tool.novel.novelTools
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentSessionTest {

    private fun writeCall(id: String) = FakeProvider.toolCall(
        id, "novel_write_paragraph",
        arguments = """{"id":"$id","storyUnitId":"su-12","orderKey":1,"text":"雪落了满肩。"}""",
    )

    @Test
    fun runsAreSerializedAndJournaled() = runTest {
        val provider = FakeProvider()
        provider.enqueueText("第一条回答")
        provider.enqueueText("第二条回答")
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"), io = StandardTestDispatcher(testScheduler))
        val session = AgentSession(
            conversationId = "c1",
            provider = provider,
            tools = novelTools(InMemoryNovelStore()),
            journal = journal,
            loopConfig = AgentLoopConfig(approvalBypass = true),
            dispatcher = StandardTestDispatcher(testScheduler),
            clock = { currentTime },
        )
        session.start()

        session.submit("第一条")
        session.submit("第二条")
        advanceUntilIdle()

        // 两个 run 串行完成，journal 有两条 run
        val history = session.history()
        assertEquals(2, history.size)
        assertEquals("第一条", (history[0].messages[0] as LLMessage.User).content)
        assertEquals("第一条回答", (history[0].messages[1] as LLMessage.Assistant).content)
        assertEquals("第二条回答", (history[1].messages[1] as LLMessage.Assistant).content)
        session.shutdown()
    }

    @Test
    fun approvalFlowsThroughStateMachine() = runTest {
        val provider = FakeProvider()
        provider.enqueue(
            FakeProvider.ScriptedTurn(deltas = listOf("写入"), toolCalls = listOf(writeCall("p-1"))),
            FakeProvider.ScriptedTurn(deltas = listOf("已写入")),
        )
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"), io = StandardTestDispatcher(testScheduler))
        val store = InMemoryNovelStore()
        store.write("p-1", "su-0", 0, "占位", baseRevision = null)
        val requests = Channel<ApprovalRequest>(Channel.UNLIMITED)
        val session = AgentSession(
            conversationId = "c1",
            provider = provider,
            tools = novelTools(store),
            journal = journal,
            approvalGate = ApprovalGate(onRequest = { requests.trySend(it) }),
            dispatcher = StandardTestDispatcher(testScheduler),
            clock = { currentTime },
        )
        val states = mutableListOf<SessionState>()
        val watcher = launch { session.state.collect { states.add(it) } }

        session.start()
        session.submit("续写")
        val req = requests.receive()
        // 锁屏场景：此刻状态是 WaitingApproval，UI 数据源就绪
        advanceTimeBy(10)
        assertEquals(SessionState.WaitingApproval::class, session.state.value::class)
        session.approvalGate.resolve(req.requestId, ApprovalDecision.Approve)
        advanceUntilIdle()

        // 状态轨迹：Idle → Running → WaitingApproval → (Resolved→Idle) → Done
        val kinds = states.map { it::class }
        assertTrue(SessionState.Running::class in kinds)
        assertTrue(SessionState.WaitingApproval::class in kinds)
        assertTrue(SessionState.Done::class in kinds)
        val done = assertIs<SessionState.Done>(session.state.value)
        assertEquals(RunEndReason.COMPLETED, done.reason)
        assertEquals("雪落了满肩。", store.get("p-1")?.text)
        watcher.cancel()
        session.shutdown()
    }

    @Test
    fun stopCancelsCurrentRunAndClearsQueuedInputs() = runTest {
        val provider = FakeProvider()
        provider.enqueue(
            FakeProvider.ScriptedTurn(deltas = (1..10).map { "段$it" }, delayMs = 100),
        )
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"), io = StandardTestDispatcher(testScheduler))
        val session = AgentSession(
            conversationId = "c1",
            provider = provider,
            tools = novelTools(InMemoryNovelStore()),
            journal = journal,
            loopConfig = AgentLoopConfig(approvalBypass = true),
            dispatcher = StandardTestDispatcher(testScheduler),
            clock = { currentTime },
        )
        val collected = mutableListOf<LoopEvent>()
        val watcher = launch { session.events.collect { collected.add(it) } }

        session.start()
        session.submit("长文A")
        session.submit("排队B")
        advanceTimeBy(150) // A 流式中
        session.stop()
        advanceUntilIdle()

        // A 中止收口，B 被清出队列（模型脚本只有 1 turn，若 B 执行会耗尽脚本抛错）
        val end = collected.last()
        assertEquals(RunEndReason.ABORTED, assertIs<LoopEvent.RunEnd>(end).reason)
        assertEquals(1, provider.requests.size)
        assertEquals(0, session.inbox.size)

        // 会话未死：还能继续接受新输入
        provider.enqueueText("恢复后的回答")
        session.submit("继续")
        advanceUntilIdle()
        assertEquals(2, session.history().size)
        watcher.cancel()
        session.shutdown()
    }

    @Test
    fun steerInjectsNudgeIntoNextTurn() = runTest {
        val provider = FakeProvider()
        provider.enqueue(
            // turn 1：慢速流式 + 工具调用，给 steer 留出时间窗
            FakeProvider.ScriptedTurn(
                deltas = listOf("看一下", "大纲"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "novel_read_outline")),
                delayMs = 100,
            ),
            // turn 2：收口（steer 应注入到这次请求）
            FakeProvider.ScriptedTurn(deltas = listOf("已按补充意见处理")),
        )
        val dir = Files.createTempDirectory("nova-j")
        val journal = JsonlJournalStore(dir.resolve("journal.jsonl"), io = StandardTestDispatcher(testScheduler))
        val session = AgentSession(
            conversationId = "c1",
            provider = provider,
            tools = novelTools(InMemoryNovelStore()),
            journal = journal,
            loopConfig = AgentLoopConfig(approvalBypass = true),
            dispatcher = StandardTestDispatcher(testScheduler),
            clock = { currentTime },
        )
        session.start()
        session.submit("续写")
        advanceTimeBy(50) // turn 1 流式中（delta 间隔 100ms）
        session.steer("补充：这一段要有爽点")
        advanceUntilIdle()

        // 第 2 次请求包含 nudge system 消息
        val second = provider.requests[1]
        val nudge = second.messages.filterIsInstance<LLMessage.System>().singleOrNull()
        assertTrue(nudge != null && nudge.nudge && nudge.content.contains("爽点"))
        // nudge 也落 journal（重放一致）
        val history = session.history()
        assertTrue(history[0].messages.any { it is LLMessage.System && it.nudge })
        session.shutdown()
    }
}
