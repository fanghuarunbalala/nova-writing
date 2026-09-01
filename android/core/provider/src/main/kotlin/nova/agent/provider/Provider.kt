package nova.agent.provider

import kotlinx.serialization.json.JsonObject
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.SamplingConfig
import nova.agent.model.ToolCall
import nova.agent.model.Usage

/** 提供给模型的工具 schema（schema 与 handler 分离：这里只有描述，执行在 ToolDispatcher）。 */
data class ToolSchema(
    val name: String,
    val description: String,
    val parameters: JsonObject,
)

data class ProviderRequest(
    val model: String,
    val system: String,
    val messages: List<LLMessage>,
    val tools: List<ToolSchema>,
    val sampling: SamplingConfig = SamplingConfig(),
    val maxTokens: Int? = null,
    /** 压缩阈值的估算信号：本次请求的粗估 token 数（桌面端 lastInputTokens 对应物）。 */
    val estimatedInputTokens: Int = 0,
)

enum class DeltaType { TEXT, REASONING }

data class ProviderDelta(val type: DeltaType, val text: String)

data class ProviderResult(
    val message: LLMessage.Assistant,
    val usage: Usage? = null,
) {
    val finishReason: FinishReason get() = message.finishReason
    val toolCalls: List<ToolCall> get() = message.toolCalls
}

/**
 * 模型提供商抽象（桌面端 core/src/runtime/provider/Provider.ts 对应物）。
 *
 * 桌面端是回调形态 onDelta；Kotlin 侧同样是 suspend 回调，取消语义免费获得：
 * 调用方协程被取消 → 实现方通过 ensureActive()/invokeOnCancellation 中断流（OkHttp 实现见 OpenAICompatProvider）。
 */
interface Provider {
    suspend fun call(request: ProviderRequest, onDelta: suspend (ProviderDelta) -> Unit): ProviderResult
}

enum class ProviderErrorKind { AUTH, RATE_LIMIT, TIMEOUT, NETWORK, SERVER, CONTEXT_LENGTH, UNKNOWN }

/** 归一化的 provider 错误。kind == CONTEXT_LENGTH 会被 loop 的超窗保险丝识别并触发强制压缩重试。 */
class ProviderException(
    val kind: ProviderErrorKind,
    message: String,
) : RuntimeException(message) {
    val isContextLength: Boolean get() = kind == ProviderErrorKind.CONTEXT_LENGTH

    companion object {
        private val CONTEXT_LENGTH_PATTERNS = listOf(
            "context_length_exceeded",
            "context length",
            "maximum context",
            "context window",
            "too many tokens",
        )

        fun fromHttpStatus(code: Int, body: String): ProviderException {
            val kind = when {
                body.containsAny(CONTEXT_LENGTH_PATTERNS) -> ProviderErrorKind.CONTEXT_LENGTH
                code == 401 || code == 403 -> ProviderErrorKind.AUTH
                code == 408 -> ProviderErrorKind.TIMEOUT
                code == 429 -> ProviderErrorKind.RATE_LIMIT
                code >= 500 -> ProviderErrorKind.SERVER
                else -> ProviderErrorKind.UNKNOWN
            }
            return ProviderException(kind, "HTTP $code: ${body.take(300)}")
        }

        private fun String.containsAny(patterns: List<String>): Boolean = patterns.any { contains(it, ignoreCase = true) }
    }
}
