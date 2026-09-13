package nova.agent.app.data

import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import nova.agent.loop.LoopEvent

/**
 * 聊天数据仓库契约（对 AgentSession 公共面的投影）。
 * 阶段2 = FakeChatRepository 脚本回放；阶段3 = 真实现（AgentSession + HttpJournalStore + SSE），
 * UI/ViewModel 经 mapLoopEvent 消费 LoopEvent，换实现零 UI 改动。
 */
interface ChatRepository {
    val events: SharedFlow<LoopEvent>
    val running: StateFlow<Boolean>

    /** 会话上下文（顶栏第二行，demo「第 2 章 · 追逃段修订 · 第 3 轮」） */
    val sessionSubtitle: String get() = ""

    /** ⋯ 菜单「会话信息」副行（demo：conv_2 · 需审核模式 · seq 213） */
    val sessionMeta: String get() = ""

    /** runSeq → 轮次分隔线文案；null = 不插 */
    fun roundLabelFor(runSeq: Int): String? = null

    /** 空闲时开新 run；运行中入队（UI 侧以 Submitted 事件即时上幽灵） */
    fun submit(text: String)

    /** 运行中插话 = 入队别名（语义显式化，对应桌面端 steer） */
    fun steer(text: String) = submit(text)

    /** 取消当前 run（RunEnd(ABORTED) 会照常上事件流） */
    fun stop()

    /** 裁决当前审批批；不在审批等待期时静默 */
    fun resolveApproval(requestId: String, approved: Boolean, comment: String? = null)

    /** 翻更旧的一页；null = 已无更旧段落 */
    suspend fun loadOlder(): OlderPage?
}

data class OlderPage(
    val prepend: List<ChatItem>,
    val hasMore: Boolean,
    /** 加载后剩余轮数（demo「剩 N 轮」口径） */
    val remainingRuns: Int = 0,
)
