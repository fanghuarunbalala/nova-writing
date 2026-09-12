package nova.agent.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import nova.agent.loop.LoopEvent
import nova.agent.model.ToolCall

/**
 * LoopEvent → ChatUiEvent 的纯映射（时钟注入保确定性）。
 * 阶段3的真实仓库（AgentSession + HttpJournalStore）同样经此函数喂 reducer，UI 零改动。
 *
 * 不映射的：Compacted（无 UI 表现）；UserMessage 映射为 UserEchoed 仅用于历史回放——
 * 交互路径的用户消息由 Submitted 即时上屏，二者以 u-r<runSeq> id 幂等去重。
 */
fun mapLoopEvent(event: LoopEvent, now: () -> Long): ChatUiEvent? {
    val ts = now()
    return when (event) {
        is LoopEvent.RunStart -> ChatUiEvent.RunStarted(event.runSeq, ts)
        is LoopEvent.AssistantDelta -> ChatUiEvent.DeltaArrived(event.textSoFar, ts)
        is LoopEvent.AssistantMessage ->
            ChatUiEvent.AssistantClosed(
                event.runSeq,
                event.message.content,
                event.message.reasoning.ifBlank { null },
                ts,
            )
        is LoopEvent.ToolCallRequest -> ChatUiEvent.ToolStarted(event.call.id, event.call.name, ts)
        is LoopEvent.ToolCallResponse -> ChatUiEvent.ToolFinished(
            event.toolCallId,
            event.name,
            ok = event.error == null,
            summary = event.content.orEmpty().take(60),
            error = event.error,
            ts = ts,
        )
        is LoopEvent.ApprovalRequested -> ChatUiEvent.ApprovalAsked(
            ApprovalUi(
                requestId = event.requestId,
                cards = event.calls.map(::approvalCardOf),
                askedAt = ts,
            ),
            ts,
        )
        is LoopEvent.ApprovalResolved -> ChatUiEvent.ApprovalSettled(event.requestId, event.decision == "approve", ts)
        is LoopEvent.RunEnd -> ChatUiEvent.RunClosed(event.reason, event.error, ts)
        is LoopEvent.UserMessage -> ChatUiEvent.UserEchoed(event.runSeq, event.content, ts)
        is LoopEvent.Compacted -> null
    }
}

/** 工具调用 arguments 里的审批载荷（demo 与阶段3真实工具共用此通道） */
@Serializable
private data class ApprovalPayload(
    val op: String = "edit",
    val title: String = "更新既有内容",
    val current: String? = null,
    val change: String = "（无变更说明）",
    val origin: String? = null,
)

private val approvalJson = Json { ignoreUnknownKeys = true }

/** arguments JSON → 卡片；解析失败回落保守占位（可回放鲁棒）。审批中心聚合复用（FR7）。 */
internal fun approvalCardOf(call: ToolCall): ApprovalCardUi {
    val payload = runCatching { approvalJson.decodeFromString<ApprovalPayload>(call.arguments) }.getOrNull()
    val op = when (payload?.op) {
        "add" -> ApprovalOp.ADD
        "delete" -> ApprovalOp.DELETE
        else -> ApprovalOp.EDIT
    }
    return ApprovalCardUi(
        id = "c-${call.id}",
        op = op,
        toolName = call.name,
        title = payload?.title ?: "更新既有内容",
        current = payload?.current,
        change = payload?.change ?: "（待解析的变更说明）",
        originChip = payload?.origin,
    )
}
