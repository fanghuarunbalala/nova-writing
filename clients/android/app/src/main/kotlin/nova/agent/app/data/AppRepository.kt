package nova.agent.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** 云端项目（UI 投影；真实源自 :core:net CloudProjectsClient） */
data class CloudProject(
    val id: String,
    val name: String,
    val updatedAtLabel: String,
    val words: Int,
    val progress: String,
)

/** 已登录设备（UI 投影） */
data class DeviceUi(
    val id: String,
    val name: String,
    val platform: String,
    val current: Boolean,
    val lastActiveLabel: String,
)

/** 登录门状态（对齐阶段1 ServerAuthSession 四态 + LoggingIn 调用期间态） */
sealed interface AuthUiState {
    data object Unconfigured : AuthUiState
    data object LoggingIn : AuthUiState
    data class Online(val username: String, val serverUrl: String) : AuthUiState
    data object Offline : AuthUiState
    data object NeedRelogin : AuthUiState
}

/**
 * 应用级仓库端口（auth/项目/设备/审批中心）。
 * 阶段3起双实现：[DemoAppRepository]（演示）与 [ServerAppRepository]（真实），
 * UI/AppViewModel 只依赖本接口（AppContainer 按 DataSource 选型）。
 */
interface AppRepository {
    val auth: StateFlow<AuthUiState>
    val projects: StateFlow<List<CloudProject>>
    val devices: StateFlow<List<DeviceUi>>
    val approvals: StateFlow<List<ApprovalUi>>
    val currentProjectId: StateFlow<String>

    val currentProject: CloudProject?

    /** 登录/注册的服务端错误文案（已按契约码映射；LoginScreen 收集展示）。 */
    val loginErrors: SharedFlow<String>

    /** 项目/设备等操作的失败提示（NovaApp snackbar 收集）。 */
    val errors: SharedFlow<String>

    fun login(username: String, password: String, deviceName: String, serverUrl: String)

    fun register(username: String, password: String, deviceName: String, serverUrl: String)

    fun logout()

    fun kick(deviceId: String)

    fun switchProject(id: String)

    fun createProject(name: String)

    fun deleteProject(id: String)

    fun resolveCenterApproval(requestId: String)

    fun resolveCenterApprovalCard(requestId: String, cardId: String, approved: Boolean)

    /** 设备列表显式刷新（DevicesScreen ON_START）。 */
    fun refreshDevices()

    /** 审批中心聚合刷新（ApprovalCenterScreen ON_START / SSE 到达）。demo 无操作。 */
    fun refreshApprovals()

    /** 离线重试（设置 Hero）：真实探活一次，恢复 Online。 */
    fun retryConnection()
}

/**
 * 演示仓库（阶段2 交付，debug 数据源开关可切回）：任意输入直接 Online。
 */
class DemoAppRepository(
    private val scope: CoroutineScope,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) : AppRepository {
    override val auth = MutableStateFlow<AuthUiState>(AuthUiState.Unconfigured)
    override val projects = MutableStateFlow<List<CloudProject>>(demoProjects())
    override val devices = MutableStateFlow<List<DeviceUi>>(demoDevices())
    override val approvals = MutableStateFlow<List<ApprovalUi>>(demoCenterApprovals())
    override val currentProjectId = MutableStateFlow<String>("p-1")

    override val currentProject: CloudProject?
        get() = projects.value.firstOrNull { it.id == currentProjectId.value }

    override val loginErrors: SharedFlow<String> = MutableSharedFlow(extraBufferCapacity = 8)
    override val errors: SharedFlow<String> = MutableSharedFlow(extraBufferCapacity = 8)

    override fun login(username: String, password: String, deviceName: String, serverUrl: String) {
        auth.value = AuthUiState.LoggingIn
        scope.launch {
            sleep(700)
            auth.value = AuthUiState.Online(username, serverUrl)
        }
    }

    override fun register(username: String, password: String, deviceName: String, serverUrl: String) =
        login(username, password, deviceName, serverUrl)

    override fun logout() {
        auth.value = AuthUiState.NeedRelogin
    }

    override fun kick(deviceId: String) {
        val target = devices.value.firstOrNull { it.id == deviceId } ?: return
        devices.value = devices.value.filterNot { it.id == deviceId }
        if (target.current) logout()
    }

    override fun switchProject(id: String) {
        currentProjectId.value = id
        projects.value = projects.value.map { if (it.id == id) it.copy(updatedAtLabel = "刚刚") else it }
    }

    override fun createProject(name: String) {
        val id = "p-${System.nanoTime()}"
        projects.value = projects.value + CloudProject(id, name, "刚刚", 0, "0 / 0 卷")
    }

    override fun deleteProject(id: String) {
        projects.value = projects.value.filterNot { it.id == id }
    }

    // ---- 演示：断线降级/恢复/四态循环（阶段2补 FR5/FR9；仅 DEMO 数据源，真实模式走 SSE/LeaseCoordinator） ----

    private var lastOnline: AuthUiState.Online? = null

    /** 断线降级（demo offlineDlg）：Offline 态，hero/顶栏胶囊联动 */
    fun demoGoOffline() {
        (auth.value as? AuthUiState.Online)?.let { lastOnline = it }
        if (auth.value is AuthUiState.Online || auth.value is AuthUiState.Offline) {
            auth.value = AuthUiState.Offline
        }
    }

    /** 等待恢复：重连退避 1/2/5/10s 模拟后恢复 Online，回调供补推 */
    fun demoWaitRecover(onRestored: () -> Unit = {}) {
        val target = lastOnline ?: AuthUiState.Online("fang", DEMO_SERVER)
        scope.launch {
            listOf(1_000L, 2_000L, 5_000L, 10_000L).forEach { sleep(it) }
            auth.value = target
            onRestored()
        }
    }

    /** 连接四态循环（演示触发器）：在线 → 离线 → 需重登（登录门）→ 在线 */
    fun demoCycleConnection() {
        auth.value = when (auth.value) {
            is AuthUiState.Online -> AuthUiState.Offline
            AuthUiState.Offline -> AuthUiState.NeedRelogin
            else -> AuthUiState.Online("fang", DEMO_SERVER)
        }
    }

    override fun resolveCenterApproval(requestId: String) {
        approvals.value = approvals.value.filterNot { it.requestId == requestId }
    }

    override fun resolveCenterApprovalCard(requestId: String, cardId: String, @Suppress("UNUSED_PARAMETER") approved: Boolean) {
        approvals.value = approvals.value.map { approval ->
            if (approval.requestId == requestId) {
                approval.copy(cards = approval.cards.filterNot { it.id == cardId })
            } else approval
        }.filterNot { it.cards.isEmpty() }
    }

    override fun refreshDevices() = Unit

    override fun refreshApprovals() = Unit

    override fun retryConnection() = Unit

    companion object {
        /** demo（L1482/1582）：fang@192.168.1.8 */
        const val DEMO_SERVER = "https://192.168.1.8:8787"

        private fun demoProjects() = listOf(
            CloudProject("p-1", "长夜余烬", "今天 21:02", 184_000, "卷一 12/26 章 · 今天 21:02 更新"),
            CloudProject("p-2", "雾都异闻录", "3 天前", 96_000, "第 8 章 · 停更 3 天"),
        )

        private fun demoDevices() = listOf(
            DeviceUi("d-1", "Pixel 9", "Android", current = true, lastActiveLabel = "当前设备 · 在线"),
            DeviceUi("d-2", "MacBook Pro · 桌面端", "macOS", current = false, lastActiveLabel = "dev_mb14 · 2 小时前活跃 · 持有 conv_2 租约"),
            DeviceUi("d-3", "iPad · 阅读端", "iPadOS", current = false, lastActiveLabel = "dev_ip02 · 3 天前活跃"),
        )

        /** 审批中心（demo renderCenter：三张卡各成一条，点击开整批 Sheet）；askedAt 取构造时刻 */
        private fun demoCenterApprovals() = listOf(
            ApprovalUi(
                requestId = "approval:conv_2:47:b2",
                askedAt = System.currentTimeMillis() - 34_000,
                cards = listOf(centerCard("cc-1", ApprovalOp.EDIT, "NovelEdit", "沈砚 · 角色档案（v2 → v3）")),
            ),
            ApprovalUi(
                requestId = "approval:conv_2:47:b2",
                askedAt = System.currentTimeMillis() - 34_000,
                cards = listOf(centerCard("cc-2", ApprovalOp.ADD, "NovelWrite", "正文 · 第 2 章 · 追逃段（草稿 812 字）")),
            ),
            ApprovalUi(
                requestId = "approval:conv_2:47:b2",
                askedAt = System.currentTimeMillis() - 34_000,
                cards = listOf(centerCard("cc-3", ApprovalOp.DELETE, "NovelDelete", "地点 · 废弃渡口碑（v1）")),
            ),
        )

        private fun centerCard(id: String, op: ApprovalOp, tool: String, title: String) = ApprovalCardUi(
            id = id,
            op = op,
            toolName = tool,
            title = title,
            current = null,
            change = "（在审批 Sheet 中查看完整变更）",
            originChip = "桌面端 · dev_mb14",
        )
    }
}
