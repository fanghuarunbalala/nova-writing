package nova.agent.app.data

import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 聊天旁路通道端口（阶段3 FR11）：一次性对话框 / 只读租约投影 / 系统胶囊 / 只读接续动作。
 * 双实现：演示 DemoTriggers（debug）与真实 ConversationCoordinator（LeaseCoordinator/SSE 喂真值）。
 * ChatViewModel/AppDrawer 只依赖本接口。
 */
interface ChatSideChannels {
    val oneShots: SharedFlow<ChatOneShot>

    val lease: StateFlow<ReadOnlyLease?>

    /** 系统胶囊文本（恢复补完/离线补推可见化，FR10）。 */
    val pills: SharedFlow<String>

    /** 只读「接续」：真实语义 = 重取租约（结果经 oneShots/lease 回流）。 */
    suspend fun resumeLease()
}
