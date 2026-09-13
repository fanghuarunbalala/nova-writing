package nova.agent.app.data

/**
 * 聊天列表项（UI 投影模型，纯 Kotlin）。
 * id 约定：UserMsg u-* / AssistantMsg a-<runSeq> / ToolLine t-<callId> /
 * GhostItem g-* / SysPill s-* / SysLine l-* / RoundLabel r-<runSeq> / AskCard q-<runSeq>；前插历史段 h-<seg>-<n>。
 */
sealed interface ChatItem {
    val id: String

    /** 轮次分隔线（demo roundDivider：「第 N 轮 · 标签」） */
    data class RoundLabel(override val id: String, val text: String) : ChatItem

    data class UserMsg(override val id: String, val text: String) : ChatItem

    data class AssistantMsg(
        override val id: String,
        val text: String,
        /** 收口时落 journal 的深度思考内容；可展开折叠 */
        val reasoning: String? = null,
        val reasoningExpanded: Boolean = false,
    ) : ChatItem

    data class ToolLine(
        override val id: String,
        val name: String,
        val phase: ToolPhase,
        val summary: String = "",
    ) : ChatItem

    /** 运行中提交的排队消息；下一次 run 开始时晋升为 [UserMsg]（纯数据变更） */
    data class GhostItem(override val id: String, val text: String, val enqueuedAt: Long) : ChatItem

    /** 居中系统胶囊（审批到达引导等） */
    data class SysPill(override val id: String, val text: String, val kind: PillKind) : ChatItem

    /** 单行 mono 留痕（demo sysLine：驳回/整批决策/超时/清空上下文等写入会话流） */
    data class SysLine(override val id: String, val text: String) : ChatItem

    /** 追问卡（AskUserQuestion；阶段4接真实交互，先占位展示） */
    data class AskCard(
        override val id: String,
        val question: String,
        val options: List<String>,
        val selected: Int? = null,
    ) : ChatItem
}

enum class PillKind { WARN, SUCCESS, DANGER, INFO }

/** 工具行三态：RUN 带起始时间戳供秒表；OK/FAIL 终态 */
sealed interface ToolPhase {
    data class Run(val ts: Long) : ToolPhase
    data object Ok : ToolPhase
    data class Fail(val error: String) : ToolPhase
}

/** 五态条（demo genRow）：Idle 之外的 busy 态见 [isBusy] */
enum class RunStatus {
    Idle, Thinking, Generating, WaitingApproval, WaitingAnswer, FailedRetry;

    val isBusy: Boolean get() = this != Idle && this != FailedRetry
}

/** 输入条三档执行模式（demo L2054-2058 文案逐字） */
enum class ExecMode(val label: String, val hint: String) {
    NEED_APPROVAL("需审核", "工具调用与档案写入均生成审批，逐项确认后执行"),
    FAST("直接执行", "不经审批直接执行工具，信任较高时使用"),
    DISCUSS("设计", "产出设计草稿，不直接改动档案与正文"),
}

/** 只读态（他端持有租约）：设备名 + 剩余秒 + SSE 进度 + 租约参数（demo：TTL 60s / 心跳 20s） */
data class ReadOnlyLease(
    val deviceId: String,
    val deviceName: String,
    val expiresAt: Long,
    val seq: Long,
    val ttlSec: Int = 60,
    val heartbeatSec: Int = 20,
)

/** 审批卡三型（demo apCard：edit=+ / add=~ / delete=−） */
enum class ApprovalOp(val symbol: String, val label: String) {
    EDIT("~", "编辑 · 将被覆盖"),
    ADD("+", "新建 · 无既有数据"),
    DELETE("−", "删除 · 将被删除"),
}

enum class ApprovalDecision { PENDING, APPROVED, REJECTED }

data class ApprovalCardUi(
    val id: String,
    val op: ApprovalOp,
    val toolName: String,
    val title: String,
    /** 当前内容（edit/delete 有；add 为 null） */
    val current: String?,
    /** 变更说明（add/edit 的目标内容；delete 为删除理由） */
    val change: String,
    /** 变更键值行（demo chgDl：「现状→…」「简介→…」）；优先于 [change] 渲染 */
    val changeRows: List<Pair<String, String>> = emptyList(),
    /** 当前内容键值行（demo delete 卡 curBox 为 dl 行） */
    val currentRows: List<Pair<String, String>> = emptyList(),
    /** 版本过期（demo verBanner）：基线版本 → 当前版本，非 null 时 edit 卡渲染黄条 */
    val baseVersion: String? = null,
    val staleVersion: String? = null,
    val originChip: String? = null,
    val decision: ApprovalDecision = ApprovalDecision.PENDING,
)

data class ApprovalUi(
    val requestId: String,
    val cards: List<ApprovalCardUi>,
    val askedAt: Long,
    val deadlineMs: Long = 120_000,
    val settled: Boolean = false,
)
