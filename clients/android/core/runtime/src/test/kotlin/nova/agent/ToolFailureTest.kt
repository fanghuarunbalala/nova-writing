package nova.agent

import app.cash.turbine.test
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.LLMessage
import nova.agent.model.StoredRun
import nova.agent.provider.FakeProvider
import nova.agent.tool.emptyParameters
import nova.agent.tool.ToolErrorCode
import nova.agent.tool.ToolException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ToolFailureTest {

    private fun brokenTool() = nova.agent.tool.ToolDef(
        name = "always_broken",
        description = "必然失败的工具",
        parameters = emptyParameters(),
        handler = { _, _ -> throw ToolException(ToolErrorCode.HANDLER_FAILED, "内部错误") },
    )

    private fun badArgsTool() = nova.agent.tool.ToolDef(
        name = "bad_args",
        description = "参数非法",
        parameters = buildJsonObject {
            put("type", "object")
            put("properties", buildJsonObject { })
        },
        handler = { _, _ -> "不应执行到这里" },
    )

    @Test
    fun handlerFailureBecomesStructuredFeedback() = runTest {
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(
                deltas = listOf("调用"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "always_broken")),
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("我注意到了失败，改为直接回答")),
            customTools = listOf(brokenTool()),
            clock = { currentTime },
        )
        h.journal.open()
        val runs = mutableListOf<StoredRun>()

        val result = h.loop().executeRun(1, "帮我做", runs)
        // 关键断言：工具失败不中断 run，模型下轮拿到失败文本继续，最终正常收口
        assertEquals(RunEndReason.COMPLETED, result.reason)

        val toolMsg = assertIs<LLMessage.Tool>(runs[0].messages[2])
        assertTrue(toolMsg.isError)
        assertEquals("工具执行失败(HANDLER_FAILED): 内部错误", toolMsg.content)
    }

    @Test
    fun invalidArgumentsRejected() = runTest {
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(
                deltas = listOf("调用"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "bad_args", arguments = "不是json")),
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("改用正确参数重试成功")),
            customTools = listOf(badArgsTool()),
            clock = { currentTime },
        )
        h.journal.open()
        val runs = mutableListOf<StoredRun>()
        val result = h.loop().executeRun(1, "go", runs)
        assertEquals(RunEndReason.COMPLETED, result.reason)
        val toolMsg = assertIs<LLMessage.Tool>(runs[0].messages[2])
        assertTrue(toolMsg.content.startsWith("工具执行失败(ARGUMENTS_INVALID)"))
    }

    @Test
    fun unknownToolRejected() = runTest {
        val h = LoopHarness(
            FakeProvider.ScriptedTurn(
                deltas = listOf("调用"),
                toolCalls = listOf(FakeProvider.toolCall("c1", "no_such_tool")),
            ),
            FakeProvider.ScriptedTurn(deltas = listOf("好的")),
            clock = { currentTime },
        )
        h.journal.open()
        val runs = mutableListOf<StoredRun>()
        val result = h.loop().executeRun(1, "go", runs)
        assertEquals(RunEndReason.COMPLETED, result.reason)
        val toolMsg = assertIs<LLMessage.Tool>(runs[0].messages[2])
        assertTrue(toolMsg.content.startsWith("工具执行失败(NOT_AVAILABLE)"))
    }
}
