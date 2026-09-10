package nova.agent.provider

import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.ToolCall
import nova.agent.model.Usage

/**
 * 脚本化假模型：单测/演示用，不触网。
 * 按顺序消费 ScriptedTurn；脚本耗尽抛 IllegalStateException（测试写错脚本比悄悄通过好）。
 * 记录收到的每个请求供断言（工具 schema 注入、消息组装、压缩效果等）。
 */
class FakeProvider : Provider {

    data class ScriptedTurn(
        val deltas: List<String>,
        val toolCalls: List<ToolCall> = emptyList(),
        val finish: FinishReason = if (toolCalls.isEmpty()) FinishReason.STOP else FinishReason.TOOL_CALL,
        val reasoningDeltas: List<String> = emptyList(),
        /** 每个 delta 之间的延时（虚拟时钟下由 runTest 跳过），0 表示不停顿。 */
        val delayMs: Long = 0,
    )

    private val script = ArrayDeque<ScriptedTurn>()
    val requests = mutableListOf<ProviderRequest>()

    fun enqueue(vararg turns: ScriptedTurn) {
        script.addAll(turns)
    }

    fun enqueueText(text: String, vararg more: String) {
        enqueue(ScriptedTurn(deltas = listOf(text) + more.toList()))
    }

    override suspend fun call(request: ProviderRequest, onDelta: suspend (ProviderDelta) -> Unit): ProviderResult {
        requests.add(request)
        if (script.isEmpty()) throw IllegalStateException("FakeProvider 脚本已耗尽，但又收到请求：${request.messages.size} 条消息")
        val turn = script.removeFirst()

        for (d in turn.reasoningDeltas) onDelta(ProviderDelta(DeltaType.REASONING, d))
        for (d in turn.deltas) {
            onDelta(ProviderDelta(DeltaType.TEXT, d))
            if (turn.delayMs > 0) kotlinx.coroutines.delay(turn.delayMs)
        }

        val message = LLMessage.Assistant(
            content = turn.deltas.joinToString(""),
            reasoning = turn.reasoningDeltas.joinToString(""),
            toolCalls = turn.toolCalls,
            finishReason = turn.finish,
        )
        return ProviderResult(
            message = message,
            usage = Usage(
                inputTokens = request.messages.sumOf { m -> (m.contentLength() * 2) / 3 },
                outputTokens = message.content.length,
            ),
        )
    }

    private fun LLMessage.contentLength(): Int = when (this) {
        is LLMessage.User -> content.length
        is LLMessage.Assistant -> content.length
        is LLMessage.Tool -> content.length
        is LLMessage.System -> content.length
    }

    companion object {
        fun toolCall(id: String, name: String, arguments: String = "{}") =
            ToolCall(id = id, name = name, arguments = arguments)
    }
}
