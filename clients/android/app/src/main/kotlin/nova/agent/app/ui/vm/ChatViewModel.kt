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
import kotlinx.coroutines.launch
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ChatRepository
import nova.agent.app.data.ChatUiEvent
import nova.agent.app.data.ChatUiState
import nova.agent.app.data.ExecMode
import nova.agent.app.data.mapLoopEvent
import nova.agent.app.data.reduce
import nova.agent.app.di.AppContainer
import nova.agent.app.di.DemoTriggers

/**
 * 聊天状态机壳：事件进 reducer 纯函数，一次性副作用走 oneShot。
 * 仓库（Fake→阶段3真）经 ChatRepository 接口注入，UI 不感知实现。
 */
class ChatViewModel private constructor(
    private val repo: ChatRepository,
    triggers: DemoTriggers,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val _oneShot = MutableSharedFlow<ChatOneShot>(extraBufferCapacity = 16)
    val oneShot: SharedFlow<ChatOneShot> = _oneShot.asSharedFlow()

    init {
        viewModelScope.launch {
            repo.events.collect { event ->
                mapLoopEvent(event) { System.currentTimeMillis() }?.let(::dispatch)
            }
        }
        viewModelScope.launch {
            triggers.oneShots.collect { _oneShot.tryEmit(it) }
        }
        viewModelScope.launch {
            triggers.lease.collect { dispatch(ChatUiEvent.LeaseObserved(it)) }
        }
    }

    private fun dispatch(event: ChatUiEvent) {
        _uiState.value = _uiState.value.reduce(event)
    }

    fun send() {
        val text = _uiState.value.input.trim()
        if (text.isEmpty()) return
        dispatch(ChatUiEvent.Submitted(text, System.currentTimeMillis()))
        repo.submit(text)
    }

    fun stop() = repo.stop()

    /** 只读接续（demo）：真实语义 = 申请租约，409 时弹冲突；阶段3 接 LeaseClient */
    fun resumeLease() {
        val holder = _uiState.value.lease?.deviceName ?: return
        _oneShot.tryEmit(ChatOneShot.Conflict409(holder))
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
                    return ChatViewModel(container.chatRepo, container.demoTriggers) as T
                }
            }
    }
}
