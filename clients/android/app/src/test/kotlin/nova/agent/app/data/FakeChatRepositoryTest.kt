package nova.agent.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason

/**
 * FakeChatRepository 时间轴回放（runTest 虚拟时间；sleep 默认 delay 即虚拟化）。
 * 覆盖 PRD FR12 时间轴：思考窗口 → delta 流 → 工具 → 审批 → 裁决 → 收口 → 幽灵自动接续。
 *
 * 收集器/仓库均为 TestScope 子协程（backgroundScope 不保证被 advanceUntilIdle 推进）。
 */
class FakeChatRepositoryTest {

    private data class Harness(val repo: FakeChatRepository, val events: MutableList<LoopEvent>)

    /** 收集器是无限 collect，必须在测试体结束处显式取消（runTest 会等子协程，60s 超时） */
    private suspend fun TestScope.withHarness(block: suspend (FakeChatRepository, MutableList<LoopEvent>) -> Unit) {
        val repoJob = Job(parent = coroutineContext[Job])
        val repo = FakeChatRepository(CoroutineScope(coroutineContext + repoJob))
        val events = mutableListOf<LoopEvent>()
        val collector = launch { repo.events.collect { events += it } }
        try {
            advanceUntilIdle()
            block(repo, events)
        } finally {
            collector.cancel()
            repoJob.cancel()
            advanceUntilIdle()
        }
    }

    @Test
    fun `init 零延时回放历史`() = runTest {
        withHarness { repo, events ->
            assertTrue(events.any { it is LoopEvent.UserMessage && it.content.contains("卷名") })
            assertTrue(events.any { it is LoopEvent.AssistantMessage })
            assertTrue(events.any { it is LoopEvent.ToolCallResponse })
            assertEquals(false, repo.running.value)
        }
    }

    @Test
    fun `完整时间轴至审批通过收口`() = runTest {
        withHarness { repo, events ->
            events.clear()

            repo.submit("续写第12章追逃段")
            runCurrent()

            // 思考窗口内：只有 RunStart，无 delta
            advanceTimeBy(2_000)
            runCurrent()
            assertTrue(events.filterIsInstance<LoopEvent.AssistantDelta>().isEmpty())

            // 2200ms 后首个 delta 出现（思考→生成切换点）
            advanceTimeBy(300)
            runCurrent()
            assertTrue(events.filterIsInstance<LoopEvent.AssistantDelta>().isNotEmpty())

            // delta 全量流完（175 ticks × 32ms ≈ 5.6s）+ 工具 + 审批征询
            advanceTimeBy(7_000)
            runCurrent()
            assertEquals(3, events.filterIsInstance<LoopEvent.ToolCallRequest>().size)
            val asked = events.filterIsInstance<LoopEvent.ApprovalRequested>().single()
            assertEquals(3, asked.calls.size)
            assertEquals(true, repo.running.value)

            // 裁决通过 → 工具 OK + 收口正文 + RunEnd COMPLETED
            repo.resolveApproval(asked.requestId, approved = true)
            advanceUntilIdle()
            assertEquals(3, events.filterIsInstance<LoopEvent.ToolCallResponse>().size)
            assertNotNull(events.filterIsInstance<LoopEvent.AssistantMessage>().singleOrNull())
            assertEquals(RunEndReason.COMPLETED, events.filterIsInstance<LoopEvent.RunEnd>().last().reason)
            assertEquals(false, repo.running.value)
        }
    }

    @Test
    fun `驳回后运行中止`() = runTest {
        withHarness { repo, events ->
            events.clear()

            repo.submit("续写")
            advanceTimeBy(9_500)
            runCurrent()
            val asked = events.filterIsInstance<LoopEvent.ApprovalRequested>().single()
            repo.resolveApproval(asked.requestId, approved = false, comment = "结尾再悬一点")
            advanceUntilIdle()
            assertEquals(RunEndReason.ABORTED, events.filterIsInstance<LoopEvent.RunEnd>().last().reason)
        }
    }

    @Test
    fun `stop 取消并发送 ABORTED 收口`() = runTest {
        withHarness { repo, events ->
            events.clear()

            repo.submit("续写")
            advanceTimeBy(3_000)
            runCurrent()
            repo.stop()
            advanceUntilIdle()
            assertEquals(RunEndReason.ABORTED, events.filterIsInstance<LoopEvent.RunEnd>().last().reason)
            assertEquals(false, repo.running.value)
        }
    }

    @Test
    fun `运行中再提交排队并在收口后自动开新 run（幽灵晋升驱动）`() = runTest {
        withHarness { repo, events ->
            events.clear()

            repo.submit("第一条")
            advanceTimeBy(4_000)
            runCurrent()
            repo.submit("排队的那条") // running → 入队
            assertEquals(1, events.filterIsInstance<LoopEvent.RunStart>().size)

            // 推进到审批征询（思考2200 + delta ~5.6s + 工具 ~0.6s ≈ 8.6s）再裁决
            advanceTimeBy(6_000)
            runCurrent()
            val approvals = events.filterIsInstance<LoopEvent.ApprovalRequested>()
            repo.resolveApproval(approvals[0].requestId, true)
            advanceUntilIdle()

            // 自动接续的第二个 run 也有自己的审批门，需再裁决一次
            val secondApprovals = events.filterIsInstance<LoopEvent.ApprovalRequested>()
            repo.resolveApproval(secondApprovals[secondApprovals.size - 1].requestId, true)
            advanceUntilIdle()

            assertEquals(2, events.filterIsInstance<LoopEvent.RunStart>().size)
            assertEquals(2, events.filterIsInstance<LoopEvent.RunEnd>().count { it.reason == RunEndReason.COMPLETED })
        }
    }

    @Test
    fun `loadOlder 两段后耗尽`() = runTest {
        withHarness { repo, _ ->
            val page1 = repo.loadOlder()
            assertNotNull(page1)
            assertEquals(100, page1.prepend.size) // 50 runs × 2 项
            assertTrue(page1.hasMore)

            val page2 = repo.loadOlder()
            assertNotNull(page2)
            assertEquals(false, page2.hasMore)

            assertNull(repo.loadOlder())
        }
    }
}
