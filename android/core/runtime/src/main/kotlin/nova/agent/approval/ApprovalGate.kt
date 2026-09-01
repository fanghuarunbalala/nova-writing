package nova.agent.approval

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import nova.agent.model.ToolCall
import java.util.concurrent.ConcurrentHashMap

/**
 * 审批门（桌面端 gateBatch + WaitRequestQueue 的进程内对应物）。
 *
 * 语义对齐桌面端：
 * - 按 turn 批量征询：一批 requireApproval 的调用合并一次征询，决策作用于整批；
 * - requestId = approval:{conversationId}:{runSeq}:b{batchSeq}，同 run 多轮不撞号；
 * - 超时（缺省 120s）自动按拒绝。
 *
 * 对桌面端缺陷的修复：决策结果随 tool 消息落 journal（桌面 WaitRequestQueue 纯内存，
 * 重启丢决策；Android 端「进程随时会死」，必须可恢复）。
 */
data class ApprovalRequest(
    val requestId: String,
    val conversationId: String,
    val runSeq: Int,
    val calls: List<ToolCall>,
)

sealed interface ApprovalDecision {
    data object Approve : ApprovalDecision

    /** comment 为驳回意见，会作为拒绝文本的一部分回填给模型。 */
    data class Reject(val comment: String? = null) : ApprovalDecision

    val label: String
        get() = when (this) {
            is Approve -> "approve"
            is Reject -> "reject"
        }
}

class ApprovalGate(
    private val timeoutMs: Long = 120_000,
    /** 征询回调：M4 在此发通知 + 置 WaitingApproval 状态（BottomSheet 数据源）。 */
    private val onRequest: suspend (ApprovalRequest) -> Unit = {},
) {
    private val pending = ConcurrentHashMap<String, CompletableDeferred<ApprovalDecision>>()

    val pendingIds: Set<String> get() = pending.keys.toSet()

    suspend fun await(request: ApprovalRequest): ApprovalDecision {
        val deferred = CompletableDeferred<ApprovalDecision>()
        pending[request.requestId] = deferred
        try {
            onRequest(request)
            return withTimeoutOrNull(timeoutMs) { deferred.await() }
                ?: ApprovalDecision.Reject("审批超时（${timeoutMs / 1000}s 无决策），按拒绝处理")
        } finally {
            // 正常决策 / 超时 / 协程取消（进程级取消由 journal 恢复兜底）都清理登记
            pending.remove(request.requestId)
        }
    }

    /** UI/用户侧回填决策。返回 false 表示该征询已不存在（超时或已决）。 */
    fun resolve(requestId: String, decision: ApprovalDecision): Boolean =
        pending.remove(requestId)?.complete(decision) ?: false
}
