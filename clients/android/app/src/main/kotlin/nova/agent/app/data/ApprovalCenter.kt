package nova.agent.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import nova.agent.approval.ApprovalDecision
import nova.agent.app.data.conversation.ConversationRegistry
import nova.agent.net.approval.ApprovalRecord
import nova.agent.net.approval.ServerApprovalChannel

/**
 * 审批中心真数据（PRD FR7）：本地会话集的 pending(cid) 并行聚合（失败静默——离线会话跳过）；
 * 跨端 resolve 直连（resolve 端点不把关租约，decided_by=裁决端 deviceId）。
 * 卡级裁决语义对齐阶段2：盖章仅为 UI 即时反馈，全卡落定才触发批级 resolve——
 * 与 server 幂等（409 already_decided）相容。
 */
class ApprovalCenter(
    private val scope: CoroutineScope,
    private val registry: ConversationRegistry,
    private val makeChannel: () -> ServerApprovalChannel,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _approvals = MutableStateFlow<List<ApprovalUi>>(emptyList())
    val approvals: StateFlow<List<ApprovalUi>> = _approvals.asStateFlow()

    fun refresh() {
        scope.launch {
            val metas = registry.conversations.value
            val lists = metas.map { meta ->
                scope.async { runCatching { makeChannel().pending(meta.conversationId) }.getOrNull() }
            }.awaitAll()
            _approvals.value = lists.mapNotNull { it }.flatten()
                .filter { it.status == "pending" }
                .map { it.toUi(now()) }
        }
    }

    /** 批级裁决（中心整条）。 */
    fun resolve(requestId: String, approved: Boolean) {
        scope.launch {
            val decision = if (approved) ApprovalDecision.Approve else ApprovalDecision.Reject(null)
            runCatching { makeChannel().resolve(requestId, decision) }
            // 本条即刻离场（server pending 已 decided；失败也先离场——下次刷新纠偏）
            _approvals.value = _approvals.value.filterNot { it.requestId == requestId }
            refresh()
        }
    }

    /** 卡级裁决：本地盖章（卡片离场，无卡条目直接离场）；全部落定自动触发批级 resolve。 */
    fun resolveCard(requestId: String, cardId: String, approved: Boolean) {
        val target = _approvals.value.firstOrNull { it.requestId == requestId } ?: return
        val stamped = _approvals.value.map { approval ->
            if (approval.requestId != requestId) approval
            else approval.copy(cards = approval.cards.filterNot { it.id == cardId })
        }.filterNot { it.requestId == requestId && it.cards.isEmpty() }
        _approvals.value = stamped
        if (stamped.none { it.requestId == requestId }) {
            resolve(requestId, approved)
        }
    }

    private fun ApprovalRecord.toUi(ts: Long): ApprovalUi = ApprovalUi(
        requestId = requestId,
        askedAt = ts,
        cards = calls.map { approvalCardOf(it) },
    )
}
