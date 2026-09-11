package nova.agent.app.data

import nova.agent.loop.RunEndReason

/** 可回放 UI 状态（重组的输入）；一次性副作用走 [ChatOneShot]，不进这里 */
data class ChatUiState(
    val items: List<ChatItem> = emptyList(),
    /** 打字机草稿：AssistantDelta 的累计文本原样替换（源端已 32ms 合并，UI 不做二次节流） */
    val draft: String = "",
    val hasMoreOlder: Boolean = true,
    val runStatus: RunStatus = RunStatus.Idle,
    val lease: ReadOnlyLease? = null,
    val input: String = "",
    val execMode: ExecMode = ExecMode.NEED_APPROVAL,
    /** 审批 sheet 数据；非 null 即弹层 */
    val pendingApproval: ApprovalUi? = null,
    /** 当前 run 起始时间戳（思考态计秒用） */
    val runStartedAt: Long? = null,
    /** 最近一次提交文本（FailedRetry 重试用） */
    val lastSubmitted: String? = null,
    /** 本地 id 计数（u-、g- 等交互即时项），保 reducer 纯函数可测 */
    internal val localId: Int = 0,
) {
    val isBusy: Boolean get() = runStatus.isBusy
    val draftCount: Int get() = draft.length
}

/**
 * reducer 输入事件。LoopEvent 经 [mapLoopEvent] 映射进来；
 * UI 动作（提交/翻页/输入）由 ViewModel 直接构造。全部携带 ts 保证纯函数确定性。
 */
sealed interface ChatUiEvent {
    data class Submitted(val text: String, val ts: Long) : ChatUiEvent
    data class RunStarted(val runSeq: Int, val ts: Long) : ChatUiEvent
    data class DeltaArrived(val textSoFar: String, val ts: Long) : ChatUiEvent
    data class AssistantClosed(val runSeq: Int, val text: String, val reasoning: String?, val ts: Long) : ChatUiEvent
    data class ToolStarted(val callId: String, val name: String, val ts: Long) : ChatUiEvent
    data class ToolFinished(val callId: String, val name: String, val ok: Boolean, val summary: String, val error: String?, val ts: Long) : ChatUiEvent
    data class ApprovalAsked(val approval: ApprovalUi, val ts: Long) : ChatUiEvent
    data class ApprovalSettled(val requestId: String, val approved: Boolean, val ts: Long) : ChatUiEvent
    /** 卡级裁决（sheet 内单卡批准/驳回的视觉盖章；全卡落定由 VM 触发批级 settle） */
    data class ApprovalCardDecided(val requestId: String, val cardId: String, val approved: Boolean) : ChatUiEvent
    data class RunClosed(val reason: RunEndReason, val error: String?, val ts: Long) : ChatUiEvent
    /** 历史/回放的用户消息（runSeq 幂等，避免与交互 Submitted 重复） */
    data class UserEchoed(val runSeq: Int, val text: String, val ts: Long) : ChatUiEvent
    data class OlderLoaded(val prepend: List<ChatItem>, val hasMore: Boolean) : ChatUiEvent
    data class InputChanged(val text: String) : ChatUiEvent
    data class ExecModeChanged(val mode: ExecMode) : ChatUiEvent
    data class LeaseObserved(val lease: ReadOnlyLease?) : ChatUiEvent
    data class ReasoningToggled(val itemId: String) : ChatUiEvent
}

/** 一次性事件（对话框/toast），不参与状态回放 */
sealed interface ChatOneShot {
    data class Conflict409(val holderDevice: String) : ChatOneShot
    data object Disconnected : ChatOneShot
    data class LeaseTakeover(val deviceName: String) : ChatOneShot
    data object ApprovalExpired : ChatOneShot
}
