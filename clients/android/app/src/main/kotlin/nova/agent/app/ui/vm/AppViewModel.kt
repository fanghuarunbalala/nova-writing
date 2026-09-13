package nova.agent.app.ui.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import nova.agent.app.data.ApprovalUi
import nova.agent.app.data.AppRepository
import nova.agent.app.data.AuthUiState
import nova.agent.app.data.CloudProject
import nova.agent.app.data.DeviceUi
import nova.agent.app.di.AppContainer
import nova.agent.app.ui.theme.NovaThemeKind

/** 应用级状态：登录门/项目/设备/审批中心/主题 */
class AppViewModel internal constructor(
    private val container: AppContainer,
) : ViewModel() {

    private val repo: AppRepository = container.appRepo

    val auth: StateFlow<AuthUiState> = repo.auth.asStateFlow()
    val projects: StateFlow<List<CloudProject>> = repo.projects.asStateFlow()
    val devices: StateFlow<List<DeviceUi>> = repo.devices.asStateFlow()
    val approvals: StateFlow<List<ApprovalUi>> = repo.approvals.asStateFlow()
    val currentProjectId: StateFlow<String> = repo.currentProjectId.asStateFlow()

    val theme: StateFlow<NovaThemeKind> = container.themeStore.theme
        .stateIn(viewModelScope, SharingStarted.Eagerly, NovaThemeKind.PAPER)

    fun login(username: String, password: String, deviceName: String, serverUrl: String = AppRepository.DEMO_SERVER) =
        repo.login(username, password, deviceName, serverUrl)

    fun register(username: String, password: String, deviceName: String, serverUrl: String = AppRepository.DEMO_SERVER) =
        repo.register(username, password, deviceName, serverUrl)

    fun logout() = repo.logout()

    fun kick(deviceId: String) = repo.kick(deviceId)

    fun createProject(name: String) = repo.createProject(name)

    fun deleteProject(id: String) = repo.deleteProject(id)

    fun resolveCenterApproval(requestId: String) = repo.resolveCenterApproval(requestId)

    fun resolveCenterApprovalCard(requestId: String, cardId: String, approved: Boolean) =
        repo.resolveCenterApprovalCard(requestId, cardId, approved)

    fun switchProject(id: String) = repo.switchProject(id)

    /** 演示：断线降级/等待恢复/四态循环（阶段2补 FR5/FR9） */
    fun demoGoOffline() = repo.demoGoOffline()

    fun demoWaitRecover(onRestored: () -> Unit = {}) = repo.demoWaitRecover(onRestored)

    fun demoCycleConnection() = repo.demoCycleConnection()

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
