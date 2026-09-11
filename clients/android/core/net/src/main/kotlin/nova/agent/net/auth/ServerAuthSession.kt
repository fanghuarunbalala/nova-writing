package nova.agent.net.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import nova.agent.net.http.NetworkUnreachableException
import nova.agent.net.http.ServerApiException

/**
 * 认证会话状态机（桌面端 ServerAuthSession 对应物）：
 * - ensureAccessToken：过期前 REFRESH_AHEAD_MS 主动轮换（Mutex 单飞——refresh 一次一换，
 *   并发用旧 token 会触发 server 复用检测误杀整个会话族）；
 * - 轮换 401 → 清令牌 + NeedRelogin（强制登录门）；网络错 → Offline（不阻塞离线只读）；
 * - accessExpiresAt 本地换算 now + ACCESS_TTL_MS（与 server jwt.ts 的 900s 对齐，不解析 JWT）。
 */
class ServerAuthSession(
    private val tokenStore: TokenStore,
    private val clientFactory: (baseUrl: String) -> ServerAuthClient,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var serverUrl: String? = null
    private var client: ServerAuthClient? = null
    private var tokens: AuthTokens? = null
    private var offline = false
    private var needRelogin = false

    private val rotateMutex = Mutex()

    private val _state = MutableStateFlow<AuthState>(AuthState.Unconfigured)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    /** 启动恢复：设 server 地址并从 store 载入令牌。url=null 即未配置。幂等。 */
    fun restore(url: String?) {
        serverUrl = url
        client = url?.let { clientFactory(it) }
        tokens = if (url != null) tokenStore.load() else null
        offline = false
        needRelogin = false
        emit()
    }

    suspend fun login(username: String, password: String, deviceName: String) =
        establish({ it.login(username, password, deviceName) }, username)

    suspend fun register(username: String, password: String, deviceName: String) =
        establish({ it.register(username, password, deviceName) }, username)

    suspend fun logout() {
        tokens?.let { t -> runCatching { client?.logout(t.refreshToken) } } // 远端吊销尽力而为
        tokens = null
        needRelogin = false
        offline = false
        tokenStore.clear()
        emit()
    }

    /**
     * 取有效 access JWT：临过期先单飞轮换。
     * 返回 null = 未配置/未登录/需重登/离线轮换失败（调用方按各自语义降级）。
     */
    suspend fun ensureAccessToken(): String? {
        if (serverUrl == null) return null
        val current = tokens ?: return null
        if (needRelogin) return null
        if (current.accessExpiresAt - REFRESH_AHEAD_MS > now()) return current.accessToken
        return rotateMutex.withLock {
            // 双检：拿锁期间可能已被并发调用者轮换
            val locked = tokens ?: return null
            if (locked.accessExpiresAt - REFRESH_AHEAD_MS > now()) locked.accessToken
            else rotate(locked)
        }
    }

    suspend fun devices(): List<DeviceInfo>? {
        val token = ensureAccessToken() ?: return null
        return client?.devices(token)
    }

    /** 踢设备；踢掉的是本机时本地令牌随之作废（server 已吊销其 session）。 */
    suspend fun kickDevice(deviceId: String) {
        val token = ensureAccessToken() ?: throw ServerApiException(0, "not_logged_in", "server 未登录")
        client?.kickDevice(token, deviceId)
        val t = tokens
        if (t != null && t.deviceId == deviceId) {
            tokens = null
            needRelogin = true
            tokenStore.clear()
            emit()
        }
    }

    /** 其他客户端上报请求结果：401 → 视令牌已死；网络失败 → Offline；成功 → 恢复 Online。 */
    fun reportRequestFailure(error: Exception) {
        when (error) {
            is ServerApiException -> if (error.status == 401) {
                if (tokens == null) { needRelogin = true; emit() }
            }
            is NetworkUnreachableException -> { offline = true; emit() }
        }
    }

    fun reportRequestSuccess() {
        if (offline) { offline = false; emit() }
    }

    private suspend fun establish(
        call: suspend (ServerAuthClient) -> AuthGrant,
        username: String,
    ) {
        val c = client ?: throw ServerApiException(0, "not_configured", "server 地址未配置")
        val grant = call(c)
        tokens = AuthTokens(
            accessToken = grant.accessToken,
            refreshToken = grant.refreshToken,
            username = username,
            userId = grant.userId,
            deviceId = grant.deviceId,
            accessExpiresAt = now() + ACCESS_TTL_MS,
        )
        offline = false
        needRelogin = false
        tokenStore.save(tokens!!)
        emit()
    }

    private suspend fun rotate(current: AuthTokens): String? {
        val c = client ?: return null
        return try {
            val grant = c.refresh(current.refreshToken)
            tokens = AuthTokens(
                accessToken = grant.accessToken,
                refreshToken = grant.refreshToken,
                username = current.username, // server 不回传用户名——保留旧值
                userId = grant.userId.ifEmpty { current.userId },
                deviceId = grant.deviceId.ifEmpty { current.deviceId },
                accessExpiresAt = now() + ACCESS_TTL_MS,
            )
            offline = false
            tokenStore.save(tokens!!)
            emit()
            tokens!!.accessToken
        } catch (e: ServerApiException) {
            if (e.status == 401) {
                tokens = null
                needRelogin = true
                tokenStore.clear()
                emit()
            } else {
                offline = true
                emit()
            }
            null
        } catch (_: NetworkUnreachableException) {
            offline = true
            emit()
            null
        }
    }

    private fun emit() {
        _state.value = computeState()
    }

    private fun computeState(): AuthState {
        val t = tokens
        return when {
            serverUrl == null -> AuthState.Unconfigured
            needRelogin -> AuthState.NeedRelogin
            t == null -> AuthState.Unconfigured
            offline -> AuthState.Offline
            else -> AuthState.Online(t.username, t.deviceId)
        }
    }

    companion object {
        const val ACCESS_TTL_MS = 15 * 60 * 1000L
        const val REFRESH_AHEAD_MS = 60 * 1000L
    }
}
