package nova.agent.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import nova.agent.app.data.AuthUiState
import nova.agent.net.auth.AuthState
import nova.agent.net.auth.DeviceInfo
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.NetworkUnreachableException
import nova.agent.net.http.ServerApiException
import nova.agent.net.http.ServerHttp
import nova.agent.net.project.CloudProject as NetCloudProject
import nova.agent.net.project.CloudProjectsClient
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 应用级真实仓库（PRD FR1/FR2）：ServerAuthSession + CloudProjectsClient 装配。
 *
 * - AuthState（net 四态）→ AuthUiState 映射（LoggingIn 由 login/register 调用期间置位）；
 * - 登录/注册错误按契约码映射文案进 [loginErrors]（400 invalid_username / 400 weak_password /
 *   409 username_taken / 401 invalid_credentials）；网络错 → Offline 不踢门；
 * - projects/devices 增删直连 server；踢本机 → 会话 NeedRelogin（ServerAuthSession 内建）。
 *
 * 审批中心（approvals）在 Step6 接 SSE + pending 聚合，本类先给空实现。
 */
class ServerAppRepository(
    private val scope: CoroutineScope,
    val authSession: ServerAuthSession,
    private val loadServerUrl: suspend () -> String,
    private val saveServerUrl: suspend (String) -> Unit,
    private val httpFactory: (String) -> ServerHttp = { ServerHttp(it) },
    private val approvalCenter: ApprovalCenter? = null,
    private val now: () -> Long = System::currentTimeMillis,
) : AppRepository {

    private var url: String = ""
    private var projectsClient: CloudProjectsClient? = null

    private val _auth = MutableStateFlow<AuthUiState>(AuthUiState.Unconfigured)
    override val auth: StateFlow<AuthUiState> = _auth.asStateFlow()

    private val _projects = MutableStateFlow<List<CloudProject>>(emptyList())
    override val projects: StateFlow<List<CloudProject>> = _projects.asStateFlow()

    private val _devices = MutableStateFlow<List<DeviceUi>>(emptyList())
    override val devices: StateFlow<List<DeviceUi>> = _devices.asStateFlow()

    /** 审批中心（FR7：pending 聚合 + SSE 通知刷新，经 ApprovalCenter 注入）。 */
    private val _approvals = MutableStateFlow<List<ApprovalUi>>(emptyList())
    override val approvals: StateFlow<List<ApprovalUi>> =
        approvalCenter?.approvals ?: _approvals.asStateFlow()

    private val _currentProjectId = MutableStateFlow("")
    override val currentProjectId: StateFlow<String> = _currentProjectId.asStateFlow()

    override val currentProject: CloudProject?
        get() = projects.value.firstOrNull { it.id == currentProjectId.value }

    private val _loginErrors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    override val loginErrors: SharedFlow<String> = _loginErrors.asSharedFlow()

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    override val errors: SharedFlow<String> = _errors.asSharedFlow()

    init {
        scope.launch { authSession.state.collect { _auth.value = mapAuth(it) } }
        scope.launch {
            val stored = loadServerUrl()
            if (stored.isNotBlank()) {
                url = stored
                authSession.restore(stored)
                refreshProjects()
                refreshDevices()
            }
        }
    }

    override fun login(username: String, password: String, deviceName: String, serverUrl: String) =
        establish(serverUrl) { authSession.login(username, password, deviceName) }

    override fun register(username: String, password: String, deviceName: String, serverUrl: String) =
        establish(serverUrl) { authSession.register(username, password, deviceName) }

    private fun establish(serverUrl: String, call: suspend () -> Unit) {
        val target = serverUrl.trim().trimEnd('/')
        scope.launch {
            _auth.value = AuthUiState.LoggingIn
            try {
                saveServerUrl(target)
                if (url != target) projectsClient = null
                url = target
                authSession.restore(target)
                call()
                nova.agent.app.di.D { "Auth establish ok url=$target" }
                refreshProjects()
                refreshDevices()
            } catch (e: ServerApiException) {
                nova.agent.app.di.D { "Auth establish 4xx/${e.status} code=${e.code}" }
                _loginErrors.tryEmit(mapLoginError(e))
                _auth.value = mapAuth(authSession.state.value)
            } catch (_: NetworkUnreachableException) {
                // 登录请求网络失败：回登录页（无令牌的 Offline 不进主界面），文案经 loginErrors
                nova.agent.app.di.D { "Auth establish network-unreachable url=$target" }
                _loginErrors.tryEmit("无法连接服务器，请检查地址与网络")
                _auth.value = AuthUiState.Unconfigured
            } catch (e: Exception) {
                // 兜底：非契约异常（解析/存储等）不让登录协程静默死亡
                nova.agent.app.di.D { "Auth establish unexpected: ${e::class.simpleName} ${e.message}" }
                _loginErrors.tryEmit("登录失败：${e.message ?: e.toString()}")
                _auth.value = mapAuth(authSession.state.value)
            }
        }
    }

    override fun logout() {
        scope.launch {
            runCatching { authSession.logout() }
            _projects.value = emptyList()
            _devices.value = emptyList()
            _currentProjectId.value = ""
        }
    }

    override fun kick(deviceId: String) {
        scope.launch {
            try {
                authSession.kickDevice(deviceId)
                refreshDevices()
            } catch (e: Exception) {
                _errors.tryEmit("踢出设备失败：${e.message}")
            }
        }
    }

    override fun switchProject(id: String) {
        _currentProjectId.value = id
    }

    override fun createProject(name: String) {
        scope.launch {
            try {
                client().create(name)
                refreshProjects()
            } catch (e: Exception) {
                _errors.tryEmit("创建项目失败：${e.message ?: e.toString()}")
            }
        }
    }

    override fun deleteProject(id: String) {
        scope.launch {
            try {
                client().remove(id)
                refreshProjects()
            } catch (e: Exception) {
                _errors.tryEmit("删除项目失败：${e.message ?: e.toString()}")
            }
        }
    }

    override fun resolveCenterApproval(requestId: String) {
        approvalCenter?.refresh() // 批级入口由中心卡片交互触发；此处仅触发重聚合
    }

    override fun resolveCenterApprovalCard(requestId: String, cardId: String, approved: Boolean) {
        approvalCenter?.resolveCard(requestId, cardId, approved)
    }

    override fun refreshApprovals() {
        approvalCenter?.refresh()
    }

    override fun refreshDevices() {
        scope.launch {
            try {
                val list = authSession.devices() ?: return@launch
                val currentId = (authSession.state.value as? AuthState.Online)?.deviceId
                _devices.value = list.map { mapDevice(it, currentId) }
            } catch (_: Exception) {
                // 后台刷新静默：401 由会话轮换路径处理
            }
        }
    }

    override fun retryConnection() {
        scope.launch {
            refreshProjects()
            refreshDevices()
        }
    }

    // ---- 内部 ----

    private fun mapAuth(s: AuthState): AuthUiState = when (s) {
        AuthState.Unconfigured -> AuthUiState.Unconfigured
        is AuthState.Online -> AuthUiState.Online(s.username, url)
        AuthState.Offline -> AuthUiState.Offline
        AuthState.NeedRelogin -> AuthUiState.NeedRelogin
    }

    private fun mapLoginError(e: ServerApiException): String = when {
        e.status == 400 && e.code == "invalid_username" -> "用户名需 3–32 个字符"
        e.status == 400 && e.code == "weak_password" -> "密码至少 8 位"
        e.status == 409 && e.code == "username_taken" -> "用户名已被占用"
        e.status == 401 -> "用户名或密码不正确"
        else -> "登录失败（${e.status} ${e.code}）"
    }

    private suspend fun client(): CloudProjectsClient {
        projectsClient?.let { return it }
        require(url.isNotBlank()) { "server 地址未配置" }
        return CloudProjectsClient(httpFactory(url), authSession).also { projectsClient = it }
    }

    private suspend fun refreshProjects() {
        try {
            val list = client().list().filter { it.archivedAt == null }
            nova.agent.app.di.D { "Repo projects ok count=${list.size} first=${list.firstOrNull()?.id}" }
            _projects.value = list.map { mapProject(it) }
            authSession.reportRequestSuccess()
            if (_currentProjectId.value.isBlank()) {
                _currentProjectId.value = list.firstOrNull()?.id ?: ""
            }
        } catch (e: ServerApiException) {
            nova.agent.app.di.D { "Repo projects api-fail ${e.status}/${e.code}" }
            authSession.reportRequestFailure(e)
        } catch (e: NetworkUnreachableException) {
            nova.agent.app.di.D { "Repo projects network-fail" }
            authSession.reportRequestFailure(e)
        }
    }

    private fun mapProject(p: NetCloudProject): CloudProject = CloudProject(
        id = p.id,
        name = p.name,
        updatedAtLabel = relativeTime(p.lastActivityAt ?: p.createdAt),
        words = 0, // 字数/进度投影归阶段4（内容域四栏）
        progress = "—",
    )

    private fun mapDevice(d: DeviceInfo, currentId: String?): DeviceUi = DeviceUi(
        id = d.id,
        name = d.name,
        platform = if (d.activeSessions > 0) "活跃会话 ×${d.activeSessions}" else "无活跃会话",
        current = d.id == currentId,
        lastActiveLabel = if (d.id == currentId) "当前会话" else relativeTime(d.lastSeenAt),
    )

    private fun relativeTime(ts: Long): String {
        if (ts <= 0) return "—"
        val diff = now() - ts
        return when {
            diff < 60_000 -> "刚刚"
            diff < 3_600_000 -> "${diff / 60_000} 分钟前"
            diff < 86_400_000 -> "${diff / 3_600_000} 小时前"
            diff < 7 * 86_400_000L -> "${diff / 86_400_000} 天前"
            else -> DATE_FMT.format(Instant.ofEpochMilli(ts).atZone(ZoneId.systemDefault()))
        }
    }

    private companion object {
        val DATE_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    }
}
