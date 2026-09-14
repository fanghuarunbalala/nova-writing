package nova.agent.app.sync

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import nova.agent.app.data.conversation.ConversationRegistry
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerHttp
import nova.agent.net.mirror.fetchReplay
import nova.agent.net.sse.ServerEvent
import nova.agent.net.sse.SseBridge

/**
 * 全局 SSE 通道（PRD FR6）：conversationId=null 常驻订阅（登录后 start/登出 stop）。
 * 消费：approval_requested（审批中心刷新 + Step7 通知）、approval_resolved（路由到对应会话 gate）、
 * lease_revoked/released（租约状态机）、journal 未知 cid（跨端会话发现）。
 *
 * **可见性过滤（2026-09-12 实测）**：全局流混有其他用户的事件（server hub 未按 userId 过滤——
 * 已回提 server 修复）。客户端兜底：未知 cid 的 journal 事件先经 replay 归属探测
 * （GET replay 对非归属用户 403），通过才登记「其他设备会话」；已判非归属的 cid 缓存跳过。
 * 全局订阅无积压回放（backlog 恒 0，纯实时），重连不丢语义由各消费方自身对账保证。
 */
class GlobalChannel(
    private val scope: CoroutineScope,
    private val baseUrl: () -> String,
    private val httpFactory: (String) -> ServerHttp,
    private val authSession: ServerAuthSession,
    private val registry: ConversationRegistry,
    private val routeApprovalResolved: (ServerEvent.ApprovalResolved) -> Unit,
    private val onLeaseReleased: () -> Unit,
    private val onApprovalRequested: (ServerEvent.ApprovalRequested) -> Unit = {},
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private var bridge: SseBridge? = null
    private var job: Job? = null

    /** 已判定非本账号的 cid（replay 403）——不再探测/登记。 */
    private val foreignCids = mutableSetOf<String>()

    fun start() {
        if (bridge != null) return
        val b = SseBridge(baseUrl(), null, authSession, io = io)
        bridge = b
        job = scope.launch {
            b.events.collect { ev -> onEvent(ev) }
        }
        b.start(scope)
    }

    suspend fun stop() {
        job?.cancel()
        job = null
        bridge?.stop()
        bridge = null
    }

    private fun onEvent(ev: ServerEvent) {
        val cid = when (ev) {
            is ServerEvent.Journal -> ev.conversationId
            is ServerEvent.ApprovalRequested -> ev.conversationId
            is ServerEvent.ApprovalResolved -> ev.conversationId
            is ServerEvent.LeaseRevoked -> ev.conversationId
            is ServerEvent.LeaseReleased -> ev.conversationId
            else -> return
        }
        val known = registry.metaOf(cid) != null
        when (ev) {
            is ServerEvent.Journal -> if (!known) discover(ev)
            is ServerEvent.ApprovalRequested -> if (known) onApprovalRequested(ev) // 未知/非归属cid不进通知与中心
            is ServerEvent.ApprovalResolved -> if (known) routeApprovalResolved(ev)
            is ServerEvent.LeaseReleased -> if (known) onLeaseReleased()
            // lease_revoked 只对持有端有意义；持有端经心跳/写路由 410 收敛，此处不处理
            else -> Unit
        }
    }

    /** 跨端会话发现（同账号他端写入的未知 cid）：replay 归属探测通过 → registry.addExternal。 */
    private fun discover(ev: ServerEvent.Journal) {
        val cid = ev.conversationId
        if (cid in foreignCids) return
        scope.launch {
            val token = authSession.ensureAccessToken() ?: return@launch
            val resp = runCatching { fetchReplay(httpFactory(baseUrl()), cid, token, since = 0, io = io) }.getOrNull()
            if (resp != null) {
                registry.addExternal(cid)
            } else {
                foreignCids += cid // 403 非归属（server 修复后此分支自然消失）
            }
        }
    }
}
