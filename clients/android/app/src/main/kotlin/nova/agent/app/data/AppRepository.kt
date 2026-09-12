package nova.agent.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** 云端项目（demo 3 项） */
data class CloudProject(
    val id: String,
    val name: String,
    val updatedAtLabel: String,
    val words: Int,
    val progress: String,
)

/** 已登录设备（demo 3 台） */
data class DeviceUi(
    val id: String,
    val name: String,
    val platform: String,
    val current: Boolean,
    val lastActiveLabel: String,
)

/** 登录门状态（对齐阶段1 ServerAuthSession 四态语义；demo 直接通过） */
sealed interface AuthUiState {
    data object Unconfigured : AuthUiState
    data object LoggingIn : AuthUiState
    data class Online(val username: String, val serverUrl: String) : AuthUiState
    data object Offline : AuthUiState
    data object NeedRelogin : AuthUiState
}

/**
 * 应用级演示仓库：auth/项目/设备/审批中心。
 * 阶段3接 :core:net（ServerAuthSession/CloudProjectsClient/设备管理端点），接口形态保持。
 */
class AppRepository(
    private val scope: CoroutineScope,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    val auth = MutableStateFlow<AuthUiState>(AuthUiState.Unconfigured)
    val projects = MutableStateFlow(demoProjects())
    val devices = MutableStateFlow(demoDevices())
    /** 审批中心待办（demo 3 项，与聊天内审批独立展示） */
    val approvals = MutableStateFlow(demoCenterApprovals())
    val currentProjectId = MutableStateFlow("p-1")

    val currentProject: CloudProject?
        get() = projects.value.firstOrNull { it.id == currentProjectId.value }

    fun login(username: String, password: String, deviceName: String) {
        auth.value = AuthUiState.LoggingIn
        scope.launch {
            sleep(700)
            auth.value = AuthUiState.Online(username, DEMO_SERVER)
        }
    }

    fun register(username: String, password: String, deviceName: String) = login(username, password, deviceName)

    fun logout() {
        auth.value = AuthUiState.NeedRelogin
    }

    /** 踢出设备；踢自己 = 本端令牌失效 → 登录门 */
    fun kick(deviceId: String) {
        val target = devices.value.firstOrNull { it.id == deviceId } ?: return
        devices.value = devices.value.filterNot { it.id == deviceId }
        if (target.current) logout()
    }

    fun switchProject(id: String) {
        currentProjectId.value = id
        projects.value = projects.value.map { if (it.id == id) it.copy(updatedAtLabel = "刚刚") else it }
    }

    fun createProject(name: String) {
        val id = "p-${System.nanoTime()}"
        projects.value = projects.value + CloudProject(id, name, "刚刚", 0, "0 / 0 卷")
    }

    /** 软删确认后的本地移除（demo） */
    fun deleteProject(id: String) {
        projects.value = projects.value.filterNot { it.id == id }
    }

    /** 审批中心条目的本地裁决（demo：不回写服务器，阶段3走真实 pending 流） */
    fun resolveCenterApproval(requestId: String) {
        approvals.value = approvals.value.filterNot { it.requestId == requestId }
    }

    /** 中心条目的单卡裁决（demo）：全部卡落定后条目消失 */
    fun resolveCenterApprovalCard(requestId: String, cardId: String, @Suppress("UNUSED_PARAMETER") approved: Boolean) {
        approvals.value = approvals.value.map { approval ->
            if (approval.requestId == requestId) {
                approval.copy(cards = approval.cards.filterNot { it.id == cardId })
            } else approval
        }.filterNot { it.cards.isEmpty() }
    }

    companion object {
        const val DEMO_SERVER = "https://nova.example.net"

        private fun demoProjects() = listOf(
            CloudProject("p-1", "长夜余烬", "3 分钟前", 412_300, "12 / 30 章"),
            CloudProject("p-2", "雾河纪年", "昨天 21:14", 88_500, "4 / 12 章"),
            CloudProject("p-3", "巴别塔维修手册", "上周三", 152_000, "9 / 9 卷 · 完结"),
        )

        private fun demoDevices() = listOf(
            DeviceUi("d-1", "Pixel 9 Pro", "Android 16", current = true, lastActiveLabel = "当前会话"),
            DeviceUi("d-2", "MacBook Pro 14", "macOS · 桌面端", current = false, lastActiveLabel = "2 小时前"),
            DeviceUi("d-3", "旧手机 · 备机", "Android 13", current = false, lastActiveLabel = "6 天前"),
        )

        private fun demoCenterApprovals() = listOf(
            ApprovalUi(
                requestId = "center-1",
                askedAt = 0,
                cards = listOf(
                    ApprovalCardUi(
                        id = "cc-1", op = ApprovalOp.EDIT, toolName = "novel_edit_outline",
                        title = "第7章大纲节点 · 雾河渡口",
                        current = "渡口老者指引主角南下，交出信物。",
                        change = "渡口老者实为雾河会哨探；信物为饵，指引即陷阱——第8章反押开始。",
                        originChip = "桌面端 · 14:02",
                    ),
                ),
            ),
            ApprovalUi(
                requestId = "center-2",
                askedAt = 0,
                cards = listOf(
                    ApprovalCardUi(
                        id = "cc-2", op = ApprovalOp.ADD, toolName = "novel_add_character",
                        title = "新人物 · 雾河会「三姐」",
                        current = null,
                        change = "渡口情报网的接头人；只闻其声不见其人，与老者构成明暗一对。",
                        originChip = "桌面端 · 13:47",
                    ),
                ),
            ),
            ApprovalUi(
                requestId = "center-3",
                askedAt = 0,
                cards = listOf(
                    ApprovalCardUi(
                        id = "cc-3", op = ApprovalOp.DELETE, toolName = "novel_remove_location",
                        title = "移除地点 · 旧渡口仓库",
                        current = "第2章用作藏身点，此后未再出场。",
                        change = "与雾河渡口职能重叠；其「藏身」职能并入渡船底舱。",
                        originChip = "桌面端 · 11:20",
                    ),
                ),
            ),
        )
    }
}
