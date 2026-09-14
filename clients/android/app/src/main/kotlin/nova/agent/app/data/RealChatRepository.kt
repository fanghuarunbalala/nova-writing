package nova.agent.app.data

import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import nova.agent.app.data.conversation.ConversationCoordinator
import nova.agent.app.data.conversation.RunSource
import nova.agent.loop.LoopEvent

/**
 * 真实聊天仓库（FR4）：ConversationCoordinator 的 ChatRepository 适配层。
 * events = 协调器中继（replay=256，会话切换换源后首屏重放）；running = 持有端会话态；
 * submit 经 inbox FIFO（幽灵排队晋升语义天然对齐）；loadOlder = run 粒度分页 fold。
 * UI/ChatViewModel 零改动（阶段2 冻结契约）。
 */
class RealChatRepository(
    private val coordinator: ConversationCoordinator,
) : ChatRepository {

    override val events: SharedFlow<LoopEvent> = coordinator.events

    override val running: StateFlow<Boolean> = coordinator.running

    override fun submit(text: String) = coordinator.startRun(RunSource.USER, text)

    override fun steer(text: String) = coordinator.steer(text)

    override fun stop() = coordinator.stop()

    override fun resolveApproval(requestId: String, approved: Boolean, comment: String?) =
        coordinator.resolveApproval(requestId, approved, comment)

    override suspend fun loadOlder(): OlderPage? = coordinator.loadOlder()
}
