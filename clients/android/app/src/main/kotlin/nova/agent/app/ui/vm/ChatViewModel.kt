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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import nova.agent.app.data.ChatItem
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
import nova.agent.app.di.DemoSignal

/**
 * 聊天状态机壳：事件进 reducer 纯函数，一次性副作用走 oneShot。
 * 仓库（Fake/Real）经 ChatRepository 接口注入，旁路通道（demo 触发器/真实协调层）经
 * ChatSideChannels 注入——UI 不感知实现（阶段3 FR11 双形态同构）。
 * 阶段2补：feedback 流（2.6s snackbar 文案）/轮次标签/模式待生效/审批超时三态/离线排队，
 * 演示语义部分以 DataSource.DEMO 门控，真实模式行为与 main 阶段3 一致。
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

    /** VM 侧发起的操作反馈（snackbar 文案），ChatScreen 收集后走全局 SnackbarHost（阶段2补 FR8） */
    private val _feedback = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val feedback: SharedFlow<String> = _feedback.asSharedFlow()

    /** BYOK 就绪（真实模式读设置；演示模式恒 true）。发送前置检查 → 引导横幅。 */
    val byokReady: StateFlow<Boolean> =
        if (container.mode == nova.agent.app.settings.DataSource.REAL) {
            container.settings.byok.map { it != null }
                .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, true)
        } else {
            MutableStateFlow(true)
        }

    /** 顶栏第二行（会话上下文，demo「第 2 章 · 追逃段修订 · 第 3 轮」） */
    val sessionSubtitle: String get() = repo.sessionSubtitle

    /** ⋯ 菜单「会话信息」副行（demo：conv_2 · 需审核模式 · seq 213） */
    val sessionMeta: String get() = repo.sessionMeta

    /** 只看进度跟随协程（只读态清除时取消） */
    private var followJob: Job? = null

    private val isDemo: Boolean get() = container.mode == nova.agent.app.settings.DataSource.DEMO

    init {
        viewModelScope.launch {
            repo.events.collect { event ->
                val mapped = mapLoopEvent(event) { System.currentTimeMillis() }
                // RunStart 补轮次标签（demo roundDivider；真实仓库返回 null 即不插）
                if (mapped is ChatUiEvent.RunStarted) {
                    dispatch(mapped.copy(roundLabel = repo.roundLabelFor(mapped.runSeq)))
                } else {
                    mapped?.let(::dispatch)
                }
            }
        }
        viewModelScope.launch {
            channels.oneShots.collect { _oneShot.tryEmit(it) }
        }
        viewModelScope.launch {
            channels.lease.collect {
                if (it == null) followJob?.cancel()
                dispatch(ChatUiEvent.LeaseObserved(it))
            }
        }
        viewModelScope.launch {
            channels.pills.collect { dispatch(ChatUiEvent.SysPillAdded(it, PillKind.INFO)) }
        }
        // 会话切换：整场重置（首屏历史经事件流重放）
        viewModelScope.launch {
            container.conversationSwitched.collect { dispatch(ChatUiEvent.ConversationReset) }
        }
        // 演示信号（抽屉演示控制区 FR9；DemoTriggers 专属，真实模式不发射）
        viewModelScope.launch {
            (channels as? nova.agent.app.di.DemoTriggers)?.demoEvents?.collect { signal ->
                when (signal) {
                    DemoSignal.FailGeneration -> repo.injectDemoFailure()
                    DemoSignal.SpeedApproval -> _uiState.value.pendingApproval?.let { pa ->
                        dispatch(ChatUiEvent.ApprovalDeadlineShortened(pa.requestId, 6_000, System.currentTimeMillis()))
                    }
                    DemoSignal.CycleConnection -> Unit // 由 AppViewModel.demoCycleConnection 处理
                }
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

    fun stop() {
        if (repo.running.value) {
            repo.stop()
        } else if (isDemo) {
            // demo 首屏伪运行（历史快照停在「生成中」）没有真实 job：本地复位五态条
            dispatch(ChatUiEvent.RunClosed(nova.agent.loop.RunEndReason.ABORTED, null, System.currentTimeMillis()))
        }
    }

    /**
     * 只读「接续」：真实 = 重取租约（结果经 oneShots/lease 回流）；
     * demo = 申请中 snackbar → 900ms 后 409（TTL/心跳文案，阶段2补 FR3）。
     */
    fun resumeLease() {
        if (isDemo) {
            val lease = _uiState.value.lease ?: return
            viewModelScope.launch {
                _feedback.emit("申请租约中（acquire conv_2）…")
                delay(900)
                _feedback.emit(
                    "409 · 租约仍由 ${lease.deviceId} 持有（TTL ${lease.ttlSec}s / 心跳 ${lease.heartbeatSec}s）" +
                        "——稍后再试，或先只读看进度",
                )
            }
        } else {
            viewModelScope.launch { channels.resumeLease() }
        }
    }

    /** 只看进度（demo roBanner 第二动作）：只读跟随，seq 每 1.2s 推进 */
    fun followLease() {
        if (!isDemo) return
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
        if (!isDemo) return
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

    /** 切执行模式 → 只挂「待生效」，随下一条消息生效（demo applyModeIfPending，阶段2补 FR2.3） */
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
        val pa = _uiState.value.pendingApproval
        if (pa != null) {
            val n = pa.cards.size
            val ok = if (approved) n else 0
            _feedback.tryEmit("整批${if (approved) "批准" else "驳回"} $ok/$n——两段式决议已持久化")
        }
        repo.resolveApproval(requestId, approved, comment)
    }

    /** 卡级裁决：视觉盖章 + 驳回意见留痕；全部落定后自动触发批级 settle 与回填反馈 */
    fun decideCard(requestId: String, cardId: String, approved: Boolean, comment: String? = null) {
        dispatch(ChatUiEvent.ApprovalCardDecided(requestId, cardId, approved, comment))
        val pa = _uiState.value.pendingApproval ?: return
        if (pa.cards.none { it.decision == nova.agent.app.data.ApprovalDecision.PENDING }) {
            val approvedCount = pa.cards.count { it.decision == nova.agent.app.data.ApprovalDecision.APPROVED }
            val rejectedCount = pa.cards.size - approvedCount
            _feedback.tryEmit("本批 ${pa.cards.size} 项已处理（$approvedCount 批准 / $rejectedCount 拒绝）——SSE approval_resolved 已回填运行中的会话")
            repo.resolveApproval(requestId, approvedCount == pa.cards.size, null)
        }
    }

    /** 120s 倒计时归零：全批「已过期」（demo server 懒过期）+ 留痕 + snackbar（阶段2补 FR4.3） */
    fun approvalTimeout(requestId: String) {
        dispatch(ChatUiEvent.ApprovalTimedOut(requestId, System.currentTimeMillis()))
        _feedback.tryEmit("120s 无决策——本批已自动拒绝")
        repo.resolveApproval(requestId, approved = false, comment = "超时未裁决，自动驳回")
    }

    /** 断线降级·排队发送（demo offlineDlg）：新指令只入幽灵队列 */
    fun setOfflineQueued(queued: Boolean) {
        dispatch(ChatUiEvent.OfflineQueueToggled(queued))
        if (queued) _feedback.tryEmit("离线排队中——指令进待发队列（上限 10k），恢复后按序补推")
    }

    /** 重连恢复（demo 退避完成后回调）：按序补推幽灵队列 */
    fun onConnectionRestored() {
        val ghosts = _uiState.value.items.filterIsInstance<ChatItem.GhostItem>()
        dispatch(ChatUiEvent.OfflineQueueToggled(false))
        if (ghosts.isNotEmpty()) {
            _feedback.tryEmit("已重连——待发队列按序补推 ${ghosts.size} 条")
            ghosts.forEach { repo.submit(it.text) }
        } else {
            _feedback.tryEmit("已重连")
        }
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
