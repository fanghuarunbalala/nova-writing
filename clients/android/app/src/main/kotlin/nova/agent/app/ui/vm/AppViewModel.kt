package nova.agent.app.ui.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import nova.agent.app.data.ApprovalUi
import nova.agent.app.data.AppRepository
import nova.agent.app.data.AuthUiState
import nova.agent.app.data.CloudProject
import nova.agent.app.data.DeviceUi
import nova.agent.app.di.AppContainer
import nova.agent.app.settings.ByokConfig
import nova.agent.app.ui.theme.NovaThemeKind

/** 应用级状态：登录门/项目/设备/审批中心/主题（repo 端口由容器按数据源选型） */
class AppViewModel internal constructor(
    private val container: AppContainer,
) : ViewModel() {

    private val repo: AppRepository = container.appRepo

    val auth: StateFlow<AuthUiState> = repo.auth
    val projects: StateFlow<List<CloudProject>> = repo.projects
    val devices: StateFlow<List<DeviceUi>> = repo.devices
    val approvals: StateFlow<List<ApprovalUi>> = repo.approvals
    val currentProjectId: StateFlow<String> = repo.currentProjectId

    /** 登录/注册的服务端错误文案（LoginScreen 收集）。 */
    val loginErrors = repo.loginErrors

    /** 项目/设备操作失败提示（NovaApp snackbar 收集）。 */
    val errors = repo.errors

    /** 已持久化的服务器地址（登录页默认值）。 */
    val serverUrlHint: StateFlow<String> = container.settings.serverUrl
        .stateIn(viewModelScope, SharingStarted.Eagerly, "")

    /** BYOK 配置（null = 未配置，聊天页据此给引导横幅）。 */
    val byok: StateFlow<ByokConfig?> = container.settings.byok
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** BYOK 连通测试状态（设置页局部展示）。 */
    val byokTest = MutableStateFlow<ByokTestState>(ByokTestState.Idle)

    fun saveByok(baseUrl: String, apiKey: String, model: String) {
        viewModelScope.launch { container.settings.setByok(baseUrl, apiKey, model) }
    }

    fun testByok() {
        viewModelScope.launch {
            byokTest.value = ByokTestState.Testing
            byokTest.value = container.testByokConnection()?.let { ByokTestState.Fail(it) } ?: ByokTestState.Ok
        }
    }

    val theme: StateFlow<NovaThemeKind> = container.themeStore.theme
        .stateIn(viewModelScope, SharingStarted.Eagerly, NovaThemeKind.PAPER)

    fun login(username: String, password: String, deviceName: String, serverUrl: String) =
        repo.login(username, password, deviceName, serverUrl)

    fun register(username: String, password: String, deviceName: String, serverUrl: String) =
        repo.register(username, password, deviceName, serverUrl)

    fun logout() = repo.logout()

    fun kick(deviceId: String) = repo.kick(deviceId)

    fun createProject(name: String) = repo.createProject(name)

    fun deleteProject(id: String) = repo.deleteProject(id)

    fun resolveCenterApproval(requestId: String) = repo.resolveCenterApproval(requestId)

    fun resolveCenterApprovalCard(requestId: String, cardId: String, approved: Boolean) =
        repo.resolveCenterApprovalCard(requestId, cardId, approved)

    fun switchProject(id: String) = repo.switchProject(id)

    // ---- 会话域（FR3；demo 模式容器给空流/空操作） ----

    val conversations: StateFlow<List<nova.agent.app.data.conversation.ConversationMeta>> = container.conversations

    val activeConversation: StateFlow<String?> = container.activeConversation

    fun openConversation(cid: String?, projectId: String?) {
        val opener = container.conversationOpener ?: return
        viewModelScope.launch {
            runCatching { opener(projectId, cid) }
            container.conversationSwitched.tryEmit(cid ?: "new")
        }
    }

    fun refreshDevices() = repo.refreshDevices()

    fun refreshApprovals() = repo.refreshApprovals()

    /** 当前是否演示数据源（演示控制区/浮条的门；重启生效切换）。 */
    val demoMode: Boolean = container.mode == nova.agent.app.settings.DataSource.DEMO

    /** 数据源切换（FR11：重启生效——容器按开关构造）。 */
    fun setDataSource(source: nova.agent.app.settings.DataSource) {
        viewModelScope.launch { container.settings.setDataSource(source) }
    }

    fun retryConnection() = repo.retryConnection()

    fun setTheme(theme: NovaThemeKind) {
        viewModelScope.launch { container.themeStore.setTheme(theme) }
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass == AppViewModel::class.java)
                    return AppViewModel(container) as T
                }
            }
    }
}

sealed interface ByokTestState {
    data object Idle : ByokTestState
    data object Testing : ByokTestState
    data object Ok : ByokTestState
    data class Fail(val message: String) : ByokTestState
}
