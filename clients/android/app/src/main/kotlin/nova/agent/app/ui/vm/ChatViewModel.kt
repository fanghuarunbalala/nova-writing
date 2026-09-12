package nova.agent.app.ui.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ChatRepository
import nova.agent.app.data.ChatSideChannels
import nova.agent.app.data.ChatUiEvent
import nova.agent.app.data.ChatUiState
import nova.agent.app.data.ExecMode
import nova.agent.app.data.PillKind
import nova.agent.app.data.mapLoopEvent
import nova.agent.app.data.reduce
import nova.agent.app.di.AppContainer

/**
 * 聊天状态机壳：事件进 reducer 纯函数，一次性副作用走 oneShot。
 * 仓库（Fake/Real）经 ChatRepository 接口注入，旁路通道（demo 触发器/真实协调层）经
 * ChatSideChannels 注入——UI 不感知实现（阶段3 FR11 双形态同构）。
 */
class ChatViewModel private constructor(
    private val repo: ChatRepository,
    private val channels: ChatSideChannels,
    private val container: AppContainer,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val _oneShot = MutableSharedFlow<ChatOneShot>(extraBufferCapacity = 16)
    val oneShot: SharedFlow<ChatOneShot> = _oneShot.asSharedFlow()

    /** BYOK 就绪（真实模式读设置；演示模式恒 true）。发送前置检查 → 引导横幅。 */
    val byokReady: StateFlow<Boolean> =
        if (container.mode == nova.agent.app.settings.DataSource.REAL) {
            container.settings.byok.map { it != null }
                .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, true)
        } else {
            MutableStateFlow(true)
        }

    init {
        viewModelScope.launch {
            repo.events.collect { event ->
                mapLoopEvent(event) { System.currentTimeMillis() }?.let(::dispatch)
            }
        }
        viewModelScope.launch {
            channels.oneShots.collect { _oneShot.tryEmit(it) }
        }
        viewModelScope.launch {
            channels.lease.collect { dispatch(ChatUiEvent.LeaseObserved(it)) }
        }
        viewModelScope.launch {
            channels.pills.collect { dispatch(ChatUiEvent.SysPillAdded(it, PillKind.INFO)) }
        }
        // 会话切换：整场重置（首屏历史经事件流重放）
        viewModelScope.launch {
            container.conversationSwitched.collect { dispatch(ChatUiEvent.ConversationReset) }
        }
    }

    private fun dispatch(event: ChatUiEvent) {
        _uiState.value = _uiState.value.reduce(event)
    }

    fun send() {
        val text = _uiState.value.input.trim()
        if (text.isEmpty()) return
        dispatch(ChatUiEvent.Submitted(text, System.currentTimeMillis()))
        val activeCid = container.activeConversation.value
        nova.agent.app.di.D { "Send text=${text.take(16)} active=$activeCid mode=${container.mode}" }
        // 无活跃会话：发送即自动建（PRD FR3 语义——不要求用户先手动开会话）
        if (container.mode == nova.agent.app.settings.DataSource.REAL && activeCid == null) {
            val opener = container.conversationOpener
            if (opener != null) {
                viewModelScope.launch {
                    val pid = container.appRepo.currentProjectId.value
                    val outcome = runCatching { opener(pid, null) }
                        .onFailure { nova.agent.app.di.D { "Send open threw: ${it::class.simpleName} ${it.message}" } }
                        .getOrNull()
                    nova.agent.app.di.D { "Send open outcome=${outcome?.let { o -> o::class.simpleName } ?: "throw"} pid=$pid" }
                    when (outcome) {
                        is nova.agent.app.data.conversation.ConversationCoordinator.OpenOutcome.Holder -> repo.submit(text)
                        is nova.agent.app.data.conversation.ConversationCoordinator.OpenOutcome.ReadOnly ->
                            dispatch(ChatUiEvent.SysPillAdded("会话被 ${outcome.holderDeviceName} 持有（只读），发送未执行", PillKind.WARN))
                        else -> dispatch(ChatUiEvent.SysPillAdded("无法连接服务器——消息已暂存，请恢复网络后重发", PillKind.WARN))
                    }
                }
                return
            }
        }
        repo.submit(text)
    }

    fun stop() = repo.stop()

    /** 只读「接续」：真实 = 重取租约（结果经 oneShots/lease 回流）；demo = 弹冲突框。 */
    fun resumeLease() {
        viewModelScope.launch { channels.resumeLease() }
    }

    /** 失败重试：用户消息已在屏上，只重启 run 不再上屏 */
    fun retry() {
        val last = _uiState.value.lastSubmitted ?: return
        repo.submit(last)
    }

    fun inputChange(text: String) = dispatch(ChatUiEvent.InputChanged(text))

    fun execModeChange(mode: ExecMode) = dispatch(ChatUiEvent.ExecModeChanged(mode))

    fun toggleReasoning(itemId: String) = dispatch(ChatUiEvent.ReasoningToggled(itemId))

    fun loadOlder() {
        viewModelScope.launch {
            repo.loadOlder()?.let { dispatch(ChatUiEvent.OlderLoaded(it.prepend, it.hasMore)) }
        }
    }

    fun decideApproval(requestId: String, approved: Boolean, comment: String? = null) {
        repo.resolveApproval(requestId, approved, comment)
    }

    /** 卡级裁决：视觉盖章；全部落定后自动触发批级 settle */
    fun decideCard(requestId: String, cardId: String, approved: Boolean) {
        dispatch(ChatUiEvent.ApprovalCardDecided(requestId, cardId, approved))
        val pa = _uiState.value.pendingApproval ?: return
        if (pa.cards.none { it.decision == nova.agent.app.data.ApprovalDecision.PENDING }) {
            repo.resolveApproval(requestId, pa.cards.all { it.decision == nova.agent.app.data.ApprovalDecision.APPROVED }, null)
        }
    }

    /** 120s 倒计时归零：自动驳回 */
    fun approvalTimeout(requestId: String) {
        repo.resolveApproval(requestId, approved = false, comment = "超时未裁决，自动驳回")
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass == ChatViewModel::class.java)
                    return ChatViewModel(container.chatRepo, container.chatChannels, container) as T
                }
            }
    }
}
