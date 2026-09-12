package nova.agent.app.data.conversation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ReadOnlyLease
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerHttp
import nova.agent.net.lease.LeaseClient
import nova.agent.net.lease.LeaseHeldException
import nova.agent.net.lease.LeaseLostException

sealed interface LeaseState {
    data object Idle : LeaseState
    data class Holder(val leaseToken: String, val expiresAt: Long) : LeaseState
    data class ReadOnly(val holderDeviceId: String, val holderDeviceName: String, val expiresAt: Long) : LeaseState
    data object Lost : LeaseState
    data object Recovering : LeaseState
}

/**
 * 租约传输端口（状态机测试用假实现；生产包装 [LeaseClient]）。
 * 结果型而非异常型：状态机分支纯数据化。
 */
interface LeaseTransport {
    sealed interface Acquire {
        data class Granted(val leaseToken: String, val expiresAt: Long, val renewed: Boolean = false) : Acquire
        data class Held(val holderDeviceId: String, val expiresAt: Long) : Acquire
        /** 403 device_revoked：本机令牌已吊销 → 联动登出。 */
        data object Revoked : Acquire
        data class Error(val message: String) : Acquire
    }

    suspend fun acquire(cid: String): Acquire

    fun startHeartbeat(scope: CoroutineScope, cid: String, token: () -> String?, onLost: (String) -> Unit): Job

    suspend fun release(cid: String, token: String)
}

/** 生产实现：LeaseClient 异常 → 结果型翻译。 */
class LeaseClientTransport(
    private val httpFactory: (String) -> ServerHttp,
    private val auth: ServerAuthSession,
    heartbeatIntervalMs: Long = 20_000,
    private val baseUrlProvider: () -> String = { "" },
) : LeaseTransport {
    private val clients = mutableMapOf<String, LeaseClient>()
    private val heartbeatInterval = heartbeatIntervalMs

    private fun client(): LeaseClient = clients.getOrPut(baseUrlProvider()) {
        LeaseClient(httpFactory(baseUrlProvider()), auth, heartbeatInterval)
    }

    override suspend fun acquire(cid: String): LeaseTransport.Acquire = try {
        val grant = client().acquire(cid)
        LeaseTransport.Acquire.Granted(grant.leaseToken, grant.expiresAt, grant.renewed)
    } catch (e: LeaseHeldException) {
        LeaseTransport.Acquire.Held(e.holderDeviceId, e.expiresAt)
    } catch (e: LeaseLostException) {
        if (e.reason == "device_revoked") LeaseTransport.Acquire.Revoked
        else LeaseTransport.Acquire.Error("${e.reason}: ${e.message}")
    } catch (e: Exception) {
        LeaseTransport.Acquire.Error(e.message ?: e.toString())
    }

    override fun startHeartbeat(scope: CoroutineScope, cid: String, token: () -> String?, onLost: (String) -> Unit): Job =
        client().startHeartbeat(scope, cid, token) { lost ->
            onLost(lost.reason)
        }

    override suspend fun release(cid: String, token: String) {
        runCatching { client().release(cid, token) } // 幂等吞错
    }
}

/**
 * 租约生命周期状态机（PRD §1.5）：
 * Idle→Holder(acquire 200 + 心跳 20s) / ReadOnly(409 lease_held)；
 * Holder→Lost(心跳 410/423 或 SSE lease_revoked)；Lost→Recovering(重取)→Holder/ReadOnly；
 * ReadOnly→Idle(SSE lease_released / 手动接续成功)；Holder→Idle(会话关闭 release)。
 *
 * 写路由 4xx（410/423）由 run 自身失败呈现（FailedRetry），心跳在 ≤20s 内追认 Lost——双通道收敛。
 */
class LeaseCoordinator(
    private val scope: CoroutineScope,
    private val transport: LeaseTransport,
    private val stopActiveRun: () -> Unit,
    private val onNeedRelogin: () -> Unit,
    /** deviceId → 设备名（devices() 映射；查不到显示短码）。 */
    private val deviceNameOf: suspend (String) -> String,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow<LeaseState>(LeaseState.Idle)
    val state: StateFlow<LeaseState> = _state.asStateFlow()

    private val _oneShots = MutableSharedFlow<ChatOneShot>(extraBufferCapacity = 8)
    val oneShots: SharedFlow<ChatOneShot> = _oneShots.asSharedFlow()

    /** gate/HttpJournalStore/RemoteNovelStore 共用的令牌供应器（只读态 = null）。 */
    val token: () -> String? = { (_state.value as? LeaseState.Holder)?.leaseToken }

    private var heartbeatJob: Job? = null
    private var conversationId: String? = null

    /** 打开会话时取租约（PRD §1.2-②：不在首次 submit 才取）。 */
    suspend fun acquire(cid: String): LeaseState {
        conversationId = cid
        return when (val r = transport.acquire(cid)) {
            is LeaseTransport.Acquire.Granted -> enterHolder(cid, r.leaseToken, r.expiresAt)
            is LeaseTransport.Acquire.Held -> {
                val name = deviceNameOf(r.holderDeviceId)
                _state.value = LeaseState.ReadOnly(r.holderDeviceId, name, r.expiresAt)
                _state.value
            }
            LeaseTransport.Acquire.Revoked -> {
                onNeedRelogin()
                _state.value = LeaseState.Lost
                _state.value
            }
            is LeaseTransport.Acquire.Error -> {
                // 网络错等：留在 Idle（UI 离线横幅），不误判只读
                _state.value = LeaseState.Idle
                _state.value
            }
        }
    }

    /** 只读「接续」/Lost 恢复重试：真实 acquire，409 弹冲突框。 */
    suspend fun resume(cid: String): LeaseState {
        _state.value = LeaseState.Recovering
        val next = acquire(cid)
        if (next is LeaseState.ReadOnly) {
            _oneShots.tryEmit(ChatOneShot.Conflict409(next.holderDeviceName))
        }
        return next
    }

    /** SSE lease_released（holder 释放）→ ReadOnly 回 Idle（可接续）。 */
    fun onLeaseReleased() {
        if (_state.value is LeaseState.ReadOnly) _state.value = LeaseState.Idle
    }

    /** SSE lease_revoked / 心跳丢失 → Lost：停当前 run（ABORTED 由 session stop 落账）+ 横幅。 */
    fun onLost(reason: String) {
        val current = _state.value
        if (current !is LeaseState.Holder) return
        heartbeatJob?.cancel()
        stopActiveRun()
        _oneShots.tryEmit(ChatOneShot.LeaseTakeover(currentDeviceName()))
        _state.value = LeaseState.Lost
        if (reason == "device_revoked") onNeedRelogin()
    }

    /** 会话关闭/登出：release（幂等吞错）→ Idle。 */
    suspend fun release() {
        heartbeatJob?.cancel()
        heartbeatJob = null
        val cid = conversationId
        val current = _state.value
        if (cid != null && current is LeaseState.Holder) {
            transport.release(cid, current.leaseToken)
        }
        conversationId = null
        _state.value = LeaseState.Idle
    }

    private fun enterHolder(cid: String, leaseToken: String, expiresAt: Long): LeaseState {
        heartbeatJob?.cancel()
        _state.value = LeaseState.Holder(leaseToken, expiresAt)
        heartbeatJob = transport.startHeartbeat(scope, cid, token) { reason -> onLost(reason) }
        return _state.value
    }

    /** UI 投影（ReadOnlyBanner 真值）：holder 名 / expiresAt 倒计时 / seq 增长（Watcher cursor）。 */
    fun leaseUi(seq: Long): ReadOnlyLease? = when (val s = _state.value) {
        is LeaseState.ReadOnly -> ReadOnlyLease(
            deviceId = s.holderDeviceId,
            deviceName = s.holderDeviceName,
            expiresAt = s.expiresAt,
            seq = seq,
        )
        else -> null
    }

    private fun currentDeviceName(): String = when (val s = _state.value) {
        is LeaseState.ReadOnly -> s.holderDeviceName
        else -> "其他设备"
    }
}
