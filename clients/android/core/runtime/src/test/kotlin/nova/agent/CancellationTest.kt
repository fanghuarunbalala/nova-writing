package nova.agent

import app.cash.turbine.test
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.StoredRun
import nova.agent.provider.FakeProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CancellationTest {

    @Test
    fun cancelMidStreamStopsWholeRunCleanly() = runTest {
        // 每 delta 延时 50ms，共 10 段 → 总 500ms 流式窗口，中途取消有充足时机
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(
                deltas = (1..10).map { "段$it" },
                delayMs = 50,
            ),
            clock = { currentTime },
            ioDispatcher = StandardTestDispatcher(testScheduler),
        )
        h.journal.open()
        val runs = mutableListOf<StoredRun>()
        val collected = mutableListOf<LoopEvent>()
        val collector = launch { h.events.collect { collected.add(it) } }

        val job = launch { h.loop().executeRun(1, "写长文", runs) }
        advanceTimeBy(220) // 流式中途（约第 4~5 段）
        job.cancel()
        job.join()
        testScheduler.runCurrent() // 让 collector 处理完 ABORTED 事件再取消
        collector.cancel()

        // 静默收口：最后一个事件是 RunEnd(ABORTED)，无错误文案
        val end = assertIs<LoopEvent.RunEnd>(collected.last())
        assertEquals(RunEndReason.ABORTED, end.reason)
        assertEquals(null, end.error)

        // 已完成的落盘不丢：snapshot 行已写（user 消息），assistant 未收口不落盘（delta 是瞬态）
        val lines = h.journalText().trim().lines()
        assertEquals(1, lines.size)
        assertTrue(lines[0].contains("\"type\":\"snapshot\""))
        // run 结构留在内存列表中，重放可恢复
        assertEquals(1, runs.size)
    }

    @Test
    fun cancelDuringToolBatch() = runTest {
        // 慢工具：handler 里 delay 500ms
        val slowTool = nova.agent.tool.ToolDef(
            name = "slow_tool",
            description = "慢工具",
            parameters = nova.agent.tool.emptyParameters(),
            handler = { _, _ ->
                kotlinx.coroutines.delay(500)
                "done"
            },
        )
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(
                deltas = listOf("调用慢工具"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "slow_tool")),
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("完成")),
            customTools = listOf(slowTool),
            clock = { currentTime },
            ioDispatcher = StandardTestDispatcher(testScheduler),
        )
        h.journal.open()
        val runs = mutableListOf<StoredRun>()

        val job = launch { h.loop().executeRun(1, "go", runs) }
        advanceTimeBy(100) // 进入工具执行
        job.cancel()
        job.join()

        // 工具批被取消：tool 消息不回填，run 在 assistant(tool_call) 处中断
        assertEquals(2, runs[0].messages.size)
        // 悬挂调用可被 Recovery 补完
        val pending = nova.agent.journal.Recovery.findPendingToolCalls(runs)
        assertEquals(listOf("c1"), pending.map { it.id })
    }
}
