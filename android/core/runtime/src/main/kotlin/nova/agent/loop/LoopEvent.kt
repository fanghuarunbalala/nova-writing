package nova.agent.loop

import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.ToolCall
import nova.agent.model.Usage

/**
 * Agent 运行时对外事件流（桌面端 LoopEvent / output hub 的对应物）。
 *
 * 分两类：
 * - 持久化域：RunStart / UserMessage / AssistantMessage / ToolCallRequest / ToolCallResponse / RunEnd，
 *   与 journal 落盘一一对应，重放可重建；
 * - 流域：AssistantDelta —— 累计文本（非增量，有意偏离桌面端的增量语义），
 *   StateFlow/Compose 拿到即「当前最新文本」，打字机效果 = 逐次重组；
 *   收集慢跳过中间值是合理语义。瞬时态不落盘。
 *
 * 顺序不变量：任何非 delta 事件发射前，必须先 flush delta 合并缓冲（见 DeltaCoalescer），
 * 保证 UI 看到的「最终文本」与随后的 AssistantMessage 一致。
 */
sealed interface LoopEvent {
    val conversationId: String
    val runSeq: Int

    data class RunStart(override val conversationId: String, override val runSeq: Int) : LoopEvent

    data class UserMessage(
        override val conversationId: String,
        override val runSeq: Int,
        val content: String,
    ) : LoopEvent

    /** textSoFar 为本次 assistant 回复的累计文本。 */
    data class AssistantDelta(
        override val conversationId: String,
        override val runSeq: Int,
        val textSoFar: String,
    ) : LoopEvent

    data class AssistantMessage(
        override val conversationId: String,
        override val runSeq: Int,
        val message: LLMessage.Assistant,
    ) : LoopEvent

    data class ToolCallRequest(
        override val conversationId: String,
        override val runSeq: Int,
        val call: ToolCall,
    ) : LoopEvent

    data class ToolCallResponse(
        override val conversationId: String,
        override val runSeq: Int,
        val toolCallId: String,
        val name: String,
        val content: String? = null,
        val error: String? = null,
    ) : LoopEvent

    /** 审批门征询：本批 requireApproval 的工具调用合并一次征询（对应桌面端 gateBatch）。 */
    data class ApprovalRequested(
        override val conversationId: String,
        override val runSeq: Int,
        val requestId: String,
        val calls: List<ToolCall>,
    ) : LoopEvent

    data class ApprovalResolved(
        override val conversationId: String,
        override val runSeq: Int,
        val requestId: String,
        val decision: String,
        val comment: String? = null,
    ) : LoopEvent

    data class Compacted(
        override val conversationId: String,
        override val runSeq: Int,
        val policy: String,
    ) : LoopEvent

    data class RunEnd(
        override val conversationId: String,
        override val runSeq: Int,
        val reason: RunEndReason,
        val finishReason: FinishReason? = null,
        val finalContent: String? = null,
        val error: String? = null,
        val usage: Usage? = null,
    ) : LoopEvent
}

enum class RunEndReason { COMPLETED, ABORTED, MAX_TURNS, FAILED }

/** 一次 run 的收口结果。 */
data class RunResult(
    val runSeq: Int,
    val reason: RunEndReason,
    val finalContent: String? = null,
    val usage: Usage = Usage(),
    val error: String? = null,
)
