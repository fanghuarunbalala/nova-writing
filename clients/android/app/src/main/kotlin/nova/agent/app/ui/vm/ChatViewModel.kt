package nova.agent.app.ui.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
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

    /** VM 侧发起的操作反馈（snackbar 文案），ChatScreen 收集后走全局 SnackbarHost */
    private val _feedback = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val feedback: SharedFlow<String> = _feedback.asSharedFlow()

    /** 顶栏第二行（会话上下文，demo「第 2 章 · 追逃段修订 · 第 3 轮」） */
    val sessionSubtitle: String get() = repo.sessionSubtitle

    /** ⋯ 菜单「会话信息」副行（demo：conv_2 · 需审核模式 · seq 213） */
    val sessionMeta: String get() = repo.sessionMeta

    /** 只看进度跟随协程（只读态清除时取消） */
    private var followJob: Job? = null

    init {
        viewModelScope.launch {
            repo.events.collect { event ->
                val mapped = mapLoopEvent(event) { System.currentTimeMillis() }
                // RunStart 补轮次标签（demo roundDivider）
                if (mapped is ChatUiEvent.RunStarted) {
                    dispatch(mapped.copy(roundLabel = repo.roundLabelFor(mapped.runSeq)))
                } else {
                    mapped?.let(::dispatch)
                }
            }
        }
        viewModelScope.launch {
            triggers.oneShots.collect { _oneShot.tryEmit(it) }
        }
        viewModelScope.launch {
            triggers.lease.collect {
                if (it == null) followJob?.cancel()
                dispatch(ChatUiEvent.LeaseObserved(it))
            }
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

    fun stop() {
        if (repo.running.value) {
            repo.stop()
        } else {
            // demo 首屏伪运行（历史快照停在「生成中」）没有真实 job：本地复位五态条
            dispatch(ChatUiEvent.RunClosed(nova.agent.loop.RunEndReason.ABORTED, null, System.currentTimeMillis()))
        }
    }

    /** 只读接续（demo L2392-2399）：申请租约 → 900ms 后 409（TTL/心跳文案）；阶段3 接 LeaseClient */
    fun resumeLease() {
        val lease = _uiState.value.lease ?: return
        viewModelScope.launch {
            _feedback.emit("申请租约中（acquire conv_2）…")
            delay(900)
            _feedback.emit(
                "409 · 租约仍由 ${lease.deviceId} 持有（TTL ${lease.ttlSec}s / 心跳 ${lease.heartbeatSec}s）" +
                    "——稍后再试，或先只读看进度",
            )
        }
    }

    /** 只看进度（demo roBanner 第二动作）：只读跟随，seq 每 1.2s 推进 */
    fun followLease() {
        if (followJob?.isActive == true) return
        _feedback.tryEmit("只读跟随中——对方每写一批，这里推进一格")
        followJob = viewModelScope.launch {
            while (isActive) {
                delay(1_200)
                _uiState.value.lease?.let { dispatch(ChatUiEvent.LeaseObserved(it.copy(seq = it.seq + 1))) }
            }
        }
    }

    /** 刷新进度（demo roFooter）：seq +7 */
    fun refreshLease() {
        val lease = _uiState.value.lease ?: return
        val next = lease.seq + 7
        dispatch(ChatUiEvent.LeaseObserved(lease.copy(seq = next)))
        _feedback.tryEmit("已同步到 seq $next")
    }

    /** 清空上下文 · 新一轮（demo ⋯ 菜单）：停当前 run + 单行留痕 */
    fun clearContext() {
        if (repo.running.value) repo.stop()
        dispatch(ChatUiEvent.ContextCleared)
        _feedback.tryEmit("已清空上下文 · 新一轮开始——此前档案与正文保留")
    }

    /** 失败重试：用户消息已在屏上，只重启 run 不再上屏 */
    fun retry() {
        val last = _uiState.value.lastSubmitted ?: return
        repo.submit(last)
    }

    fun inputChange(text: String) = dispatch(ChatUiEvent.InputChanged(text))

    /** 切执行模式 → 只挂「待生效」，随下一条消息生效（demo applyModeIfPending） */
    fun execModeChange(mode: ExecMode) {
        val current = _uiState.value.execMode
        dispatch(ChatUiEvent.ExecModeChanged(mode))
        if (mode != current) _feedback.tryEmit("执行模式将随下一条消息生效（会话级）")
    }

    fun toggleReasoning(itemId: String) = dispatch(ChatUiEvent.ReasoningToggled(itemId))

    fun loadOlder() {
        viewModelScope.launch {
            val page = repo.loadOlder()
            if (page != null) {
                dispatch(ChatUiEvent.OlderLoaded(page.prepend, page.hasMore, page.remainingRuns))
                _feedback.tryEmit("已加载更早 1 段（分段懒加载 · 前插锚点不跳）")
            } else {
                // 耗尽：置 hasMoreOlder=false，按钮落「已至开头」终态（修复残留失效按钮）
                dispatch(ChatUiEvent.OlderLoaded(emptyList(), hasMore = false, remaining = 0))
            }
        }
    }

    fun decideApproval(requestId: String, approved: Boolean, comment: String? = null) {
        repo.resolveApproval(requestId, approved, comment)
    }

    /** 卡级裁决：视觉盖章 + 驳回意见留痕；全部落定后自动触发批级 settle */
    fun decideCard(requestId: String, cardId: String, approved: Boolean, comment: String? = null) {
        dispatch(ChatUiEvent.ApprovalCardDecided(requestId, cardId, approved, comment))
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
