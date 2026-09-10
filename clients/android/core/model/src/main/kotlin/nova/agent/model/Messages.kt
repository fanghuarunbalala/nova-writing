package nova.agent.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 与模型对话的最小消息单元（桌面端 core/src/runtime/loop/types.ts 的 LLMessage 对应物）。
 *
 * 会话持久化的最小单位是 run（一次用户消息驱动的完整周期），run 内消息自闭环：
 * user → (assistant → tool)* → assistant(final)。journal 以行为单位追加本类型的序列化 JSON。
 */
@Serializable
sealed interface LLMessage {

    @Serializable
    @SerialName("user")
    data class User(val content: String) : LLMessage

    @Serializable
    @SerialName("assistant")
    data class Assistant(
        val content: String = "",
        /** 深度思考内容（DeepSeek reasoning_content 等）。瞬时 delta 不上事件流，只在收口时随消息落 journal。 */
        val reasoning: String = "",
        /** 本轮要执行的工具调用；finishReason == TOOL_CALL 时非空。 */
        val toolCalls: List<ToolCall> = emptyList(),
        val finishReason: FinishReason = FinishReason.STOP,
    ) : LLMessage

    @Serializable
    @SerialName("tool")
    data class Tool(
        val toolCallId: String,
        val name: String,
        val content: String,
        /** 工具失败回填时为 true：错误文本照常作为 tool 消息 append（否则下轮 provider 缺 tool result 会 400）。 */
        val isError: Boolean = false,
    ) : LLMessage

    @Serializable
    @SerialName("system")
    data class System(
        val content: String,
        /** nudge 标记：steer 注入的临时提醒，下次组装请求前会被清扫（对应桌面端 sweepNudgeMessages）。 */
        val nudge: Boolean = false,
    ) : LLMessage
}

/** 模型一次工具调用请求。arguments 保持原始 JSON 字符串，由工具 handler 自行解析校验。 */
@Serializable
data class ToolCall(
    val id: String,
    val name: String,
    val arguments: String = "{}",
)

@Serializable
enum class FinishReason { STOP, TOOL_CALL, LENGTH }

@Serializable
data class Usage(val inputTokens: Int = 0, val outputTokens: Int = 0) {
    operator fun plus(other: Usage) = Usage(inputTokens + other.inputTokens, outputTokens + other.outputTokens)
}

@Serializable
data class SamplingConfig(
    val temperature: Double = 1.0,
    val topP: Double = 1.0,
)
