package nova.agent

import app.cash.turbine.test
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import nova.agent.loop.AgentLoopConfig
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.provider.FakeProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AgentLoopTest {

    @Test
    fun happyPathWithToolCall() = runTest {
        val h = LoopHarness(
            // turn 1：流式输出 + 工具调用（读大纲，免审）
            FakeProvider.ScriptedTurn(
                deltas = listOf("我先看", "一下大纲"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "novel_read_outline")),
            ),
            // turn 2：收口
            FakeProvider.ScriptedTurn(deltas = listOf("第12章", "续写完成")),
            clock = { currentTime },
        )
        h.journal.open()
        val loop = h.loop()
        val runs = mutableListOf<StoredRun>()

        h.events.test {
            val result = loop.executeRun(1, "续写第12章", runs)

            assertEquals(RunEndReason.COMPLETED, result.reason)
            assertEquals("第12章续写完成", result.finalContent)

            // 事件序（delta 在虚拟时钟下 32ms 窗口内合并为一次，收口前 flush）
            assertIs<LoopEvent.RunStart>(awaitItem())
            assertEquals("续写第12章", assertIs<LoopEvent.UserMessage>(awaitItem()).content)
            assertEquals("我先看一下大纲", assertIs<LoopEvent.AssistantDelta>(awaitItem()).textSoFar)
            val req = assertIs<LoopEvent.ToolCallRequest>(awaitItem())
            assertEquals("novel_read_outline", req.call.name)
            assertTrue(assertIs<LoopEvent.ToolCallResponse>(awaitItem()).content!!.startsWith("（该范围暂无段落）"))
            assertEquals("第12章续写完成", assertIs<LoopEvent.AssistantDelta>(awaitItem()).textSoFar)
            val final = assertIs<LoopEvent.AssistantMessage>(awaitItem())
            assertEquals("第12章续写完成", final.message.content)
            val end = assertIs<LoopEvent.RunEnd>(awaitItem())
            assertEquals(RunEndReason.COMPLETED, end.reason)
            assertEquals(FinishReason.STOP, end.finishReason)
            assertEquals("第12章续写完成", end.finalContent)
            expectNoEvents()
            cancelAndIgnoreRemainingEvents()
        }

        // run 消息自闭环：user → assistant(tool_call) → tool → assistant(final)
        assertEquals(1, runs.size)
        assertEquals(4, runs[0].messages.size)
        assertIs<LLMessage.User>(runs[0].messages[0])
        val assistant1 = assertIs<LLMessage.Assistant>(runs[0].messages[1])
        assertEquals(FinishReason.TOOL_CALL, assistant1.finishReason)
        assertEquals(1, assistant1.toolCalls.size)
        assertIs<LLMessage.Tool>(runs[0].messages[2])
        val assistant2 = assertIs<LLMessage.Assistant>(runs[0].messages[3])
        assertEquals(FinishReason.STOP, assistant2.finishReason)

        // provider 收到的请求：第 2 轮带上了第 1 轮的 assistant/tool 消息（回填进上下文）
        assertEquals(2, h.provider.requests.size)
        assertEquals(1, h.provider.requests[0].messages.size) // turn1 只有 user
        assertEquals(3, h.provider.requests[1].messages.size) // turn2 = user + assistant(tool_call) + tool
        assertTrue(h.provider.requests[0].tools.any { it.name == "novel_read_outline" })
    }

    @Test
    fun maxTurnsExhausted() = runTest {
        val h = LoopHarness(
            *Array(3) {
                FakeProvider.ScriptedTurn(
                    deltas = listOf("turn$it"),
                    toolCalls = listOf(FakeProvider.toolCall("c$it", "novel_read_outline")),
                )
            },
            loopConfig = AgentLoopConfig(maxTurns = 2, approvalBypass = true),
            clock = { currentTime },
        )
        h.journal.open()
        val runs = mutableListOf<StoredRun>()

        h.events.test {
            val result = h.loop().executeRun(1, "停不下来的模型", runs)
            assertEquals(RunEndReason.MAX_TURNS, result.reason)
            // 跳过中间事件，断言最终 RunEnd
            var e = awaitItem()
            while (e !is LoopEvent.RunEnd) e = awaitItem()
            assertEquals(RunEndReason.MAX_TURNS, (e as LoopEvent.RunEnd).reason)
            cancelAndIgnoreRemainingEvents()
        }
        assertEquals(2, h.provider.requests.size)
    }

    @Test
    fun journalLineOrder() = runTest {
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(
                deltas = listOf("调用工具"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "novel_read_outline")),
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("完成")),
            clock = { currentTime },
        )
        h.journal.open()
        h.loop().executeRun(1, "hi", mutableListOf())

        val lines = h.journalText().trim().lines()
        assertEquals(4, lines.size) // snapshot + assistant + tool批 + final assistant
        assertTrue(lines[0].contains("\"type\":\"snapshot\""))
        assertTrue(lines[1].contains("\"type\":\"append\""))
        assertTrue(lines[2].contains("\"type\":\"tool\""))
        assertTrue(lines[3].contains("\"type\":\"assistant\""))

        // 重放重建 = 内存一致
        val replayed = h.journal.readAll()
        assertEquals(1, replayed.size)
        assertEquals(4, replayed[0].messages.size)
    }
}
