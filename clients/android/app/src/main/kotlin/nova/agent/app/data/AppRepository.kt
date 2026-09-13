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

    fun login(username: String, password: String, deviceName: String, serverUrl: String = DEMO_SERVER) {
        auth.value = AuthUiState.LoggingIn
        scope.launch {
            sleep(700)
            auth.value = AuthUiState.Online(username, serverUrl)
        }
    }

    fun register(username: String, password: String, deviceName: String, serverUrl: String = DEMO_SERVER) =
        login(username, password, deviceName, serverUrl)

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
