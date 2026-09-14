package nova.agent.app.data

import nova.agent.loop.RunEndReason

/** 可回放 UI 状态（重组的输入）；一次性副作用走 [ChatOneShot]，不进这里 */
data class ChatUiState(
    val items: List<ChatItem> = emptyList(),
    /** 打字机草稿：AssistantDelta 的累计文本原样替换（源端已 32ms 合并，UI 不做二次节流） */
    val draft: String = "",
    val hasMoreOlder: Boolean = true,
    /** 更早对话剩余轮数（demo 按钮文案「加载更早的对话 · 剩 8 轮」） */
    val olderRunsRemaining: Int = 8,
    val runStatus: RunStatus = RunStatus.Idle,
    /** run 失败原因（FailedRetry 横幅真实文案；其余态为 null） */
    val runError: String? = null,
    val lease: ReadOnlyLease? = null,
    val input: String = "",
    val execMode: ExecMode = ExecMode.NEED_APPROVAL,
    /** 「待生效」执行模式（demo pendModeChip）：切换不立即生效，随下一条消息应用 */
    val pendingExecMode: ExecMode? = null,
    /** 审批 sheet 数据；非 null 即弹层 */
    val pendingApproval: ApprovalUi? = null,
    /** 断线降级·排队发送（demo offlineDlg）：新指令只入幽灵队列，恢复后按序补推 */
    val offlineQueued: Boolean = false,
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
    data class RunStarted(val runSeq: Int, val ts: Long, val roundLabel: String? = null) : ChatUiEvent
    data class DeltaArrived(val textSoFar: String, val ts: Long) : ChatUiEvent
    data class AssistantClosed(val runSeq: Int, val text: String, val reasoning: String?, val ts: Long) : ChatUiEvent
    data class ToolStarted(val callId: String, val name: String, val ts: Long) : ChatUiEvent
    data class ToolFinished(val callId: String, val name: String, val ok: Boolean, val summary: String, val error: String?, val ts: Long) : ChatUiEvent
    data class ApprovalAsked(val approval: ApprovalUi, val ts: Long) : ChatUiEvent
    data class ApprovalSettled(val requestId: String, val approved: Boolean, val ts: Long) : ChatUiEvent
    /** 卡级裁决（sheet 内单卡批准/驳回的视觉盖章；全卡落定由 VM 触发批级 settle）；驳回意见随事件留痕 */
    data class ApprovalCardDecided(val requestId: String, val cardId: String, val approved: Boolean, val comment: String? = null) : ChatUiEvent
    /** 清空上下文 · 新一轮（demo ⋯ 菜单） */
    data object ContextCleared : ChatUiEvent
    /** 120s 无决策·超时（demo server 懒过期）：全卡 EXPIRED + 留痕 + 关 Sheet */
    data class ApprovalTimedOut(val requestId: String, val ts: Long) : ChatUiEvent
    /** 演示触发器·超时速演（demo 6s 倒计时） */
    data class ApprovalDeadlineShortened(val requestId: String, val deadlineMs: Long, val ts: Long) : ChatUiEvent
    /** 断线降级·排队发送开关 */
    data class OfflineQueueToggled(val queued: Boolean) : ChatUiEvent
    data class RunClosed(val reason: RunEndReason, val error: String?, val ts: Long) : ChatUiEvent
    /** 历史/回放的用户消息（runSeq 幂等，避免与交互 Submitted 重复） */
    data class UserEchoed(val runSeq: Int, val text: String, val ts: Long) : ChatUiEvent
    data class OlderLoaded(val prepend: List<ChatItem>, val hasMore: Boolean, val remaining: Int = 0) : ChatUiEvent
    data class InputChanged(val text: String) : ChatUiEvent
    data class ExecModeChanged(val mode: ExecMode) : ChatUiEvent
    data class LeaseObserved(val lease: ReadOnlyLease?) : ChatUiEvent
    data class ReasoningToggled(val itemId: String) : ChatUiEvent
    /** 系统胶囊（恢复补完/离线补推等可见化，FR10） */
    data class SysPillAdded(val text: String, val kind: PillKind) : ChatUiEvent
    /** 会话切换：状态整场重置（首屏历史经事件流重放） */
    data object ConversationReset : ChatUiEvent
}

/** 一次性事件（对话框/toast），不参与状态回放 */
sealed interface ChatOneShot {
    data class Conflict409(val holderDevice: String) : ChatOneShot
    data object Disconnected : ChatOneShot
    data class LeaseTakeover(val deviceName: String) : ChatOneShot
    data object ApprovalExpired : ChatOneShot
}
