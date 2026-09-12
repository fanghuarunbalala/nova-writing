package nova.agent.app.data.conversation

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ChatSideChannels
import nova.agent.app.data.ReadOnlyLease
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalGate
import nova.agent.definition.DefinitionAssembler
import nova.agent.definition.DefinitionBundle
import nova.agent.loop.LoopEvent
import nova.agent.model.StoredRun
import nova.agent.net.approval.ServerApprovalChannel
import nova.agent.net.auth.ServerAuthSession
import nova.agent.net.http.ServerHttp
import nova.agent.net.journal.HttpJournalStore
import nova.agent.net.journal.PendingPushQueue
import nova.agent.net.mirror.JournalMirror
import nova.agent.net.mirror.ReplayRow
import nova.agent.net.mirror.fetchReplay
import nova.agent.net.project.CloudProjectsClient
import nova.agent.net.project.RemoteNovelStore
import nova.agent.net.sse.ServerEvent
import nova.agent.net.sse.SseBridge
import nova.agent.provider.Provider
import nova.agent.session.AgentSession
import nova.agent.session.SessionState
import nova.agent.tool.novel.novelTools
import java.nio.file.Path

/**
 * 会话协调器（PRD FR3/FR4/FR5 的装配核心）：
 * 打开 = acquire → Holder（AgentSession 全家桶）或 ReadOnly（per-conv SSE Watcher）；
 * 持有端写入 = HttpJournalStore + RemoteNovelStore(oplog) + ServerApprovalChannel.gate；
 * 只读端 = JournalProjector 折叠 SSE journal 增量喂同一事件流——与持有端共用 UI 投影管线。
 *
 * 切换会话：旧会话 park（心跳/journal/SSE 存续，活跃 run 后台继续，PRD FR3），
 * 重附着 = 全量首屏重放（后台完成的 run 在 journal 里补齐）。
 * 会话执行挂 applicationScope 单例（非 Service 作用域，§1.2-⑦）；FGS 存活谓词读本类状态。
 */
class ConversationCoordinator(
    private val scope: CoroutineScope,
    val registry: ConversationRegistry,
    private val leaseCoordinator: LeaseCoordinator,
    private val baseUrl: () -> String,
    private val httpFactory: (String) -> ServerHttp,
    private val authSession: ServerAuthSession,
    private val pendingQueue: PendingPushQueue,
    private val providerFactory: suspend () -> Provider?,
    private val loadDefinition: suspend () -> DefinitionBundle?,
    private val definitionCaps: DefinitionAssembler.Capabilities? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) : ChatSideChannels {

    sealed interface OpenOutcome {
        data object Holder : OpenOutcome
        data class ReadOnly(val holderDeviceName: String) : OpenOutcome
        data object Offline : OpenOutcome
    }

    data class Active(
        val conversationId: String,
        val projectId: String?,
        val readOnly: Boolean,
    )

    private data class Held(
        val session: AgentSession,
        val gate: ApprovalGate,
        val channel: ServerApprovalChannel,
        val store: RemoteNovelStore,
        var relayJob: Job,
    )

    private data class Watch(val bridge: SseBridge, var collectorJob: Job)

    private val _active = MutableStateFlow<Active?>(null)
    val active: StateFlow<Active?> = _active.asStateFlow()

    private val _events = MutableSharedFlow<LoopEvent>(replay = 256, extraBufferCapacity = 512)
    val events: SharedFlow<LoopEvent> = _events.asSharedFlow()

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    /** 当前会话的 session 原始态（FGS 通知文案：思考/生成/等待审批）。 */
    private val _sessionState = MutableStateFlow<SessionState?>(null)
    val sessionState: StateFlow<SessionState?> = _sessionState.asStateFlow()

    private val _watchActive = MutableStateFlow(false)

    /**
     * FGS 存活谓词（§1.2-⑦ 不变式）：持租约 ∨ 活跃 run ∨ 只读 Watcher 活跃。
     * GlobalChannel 单独不保活（空闲即停，OQ③ 落定）——进程被冻时其静默死、回前台游标重连收敛。
     */
    val fgsRequired: StateFlow<Boolean> =
        combine(leaseCoordinator.state, _running, _watchActive) { lease, run, watch ->
            lease is LeaseState.Holder || run || watch
        }.stateIn(scope, kotlinx.coroutines.flow.SharingStarted.Eagerly, false)

    /** FGS 常驻通知文案。 */
    val fgsLine: StateFlow<String> =
        combine(_sessionState, _watchActive) { s, watch ->
            when {
                s is SessionState.WaitingApproval -> "等待审批裁决"
                s is SessionState.Running -> "写作进行中"
                s != null -> "会话保持中"
                watch -> "只读跟随中"
                else -> "后台同步中"
            }
        }.stateIn(scope, kotlinx.coroutines.flow.SharingStarted.Eagerly, "后台同步中")

    private val _oneShots = MutableSharedFlow<ChatOneShot>(extraBufferCapacity = 8)
    override val oneShots: SharedFlow<ChatOneShot> = _oneShots.asSharedFlow()

    private val _pills = MutableSharedFlow<String>(extraBufferCapacity = 8)
    override val pills: SharedFlow<String> = _pills.asSharedFlow()

    private val watchSeq = MutableStateFlow(0L)
    private val leaseUi: StateFlow<ReadOnlyLease?> =
        combine(leaseCoordinator.state, watchSeq) { _, seq -> leaseCoordinator.leaseUi(seq) }
            .stateIn(scope, kotlinx.coroutines.flow.SharingStarted.Eagerly, null)

    override val lease: StateFlow<ReadOnlyLease?> get() = leaseUi

    private val held = LinkedHashMap<String, Held>()
    private val watchers = LinkedHashMap<String, Watch>()
    private var paging = HistoryPaging()
    private val replayCache = LinkedHashMap<String, MutableList<ReplayRow>>()
    private val announcedRuns = mutableSetOf<Int>()

    init {
        // LeaseCoordinator 的丢失处置接到本协调层（停 run → 横幅 → Lost）
        scope.launch { leaseCoordinator.oneShots.collect { _oneShots.tryEmit(it) } }
        scope.launch { registry.scan() }
    }

    /** 打开会话（cid=null = 新建）。 */
    suspend fun open(projectId: String?, cid: String?): OpenOutcome {
        val conversationId = if (cid != null) {
            cid
        } else {
            val newId = registry.newConversationId()
            registry.register(newId, projectId ?: "", "新会话")
            newId
        }
        paging = HistoryPaging()
        announcedRuns.clear()
        return when (val st = leaseCoordinator.acquire(conversationId)) {
            is LeaseState.Holder -> {
                attachHolder(conversationId, projectId)
                OpenOutcome.Holder
            }
            is LeaseState.ReadOnly -> {
                attachWatcher(conversationId, projectId)
                OpenOutcome.ReadOnly(st.holderDeviceName)
            }
            else -> {
                _active.value = Active(conversationId, projectId, readOnly = true)
                OpenOutcome.Offline
            }
        }
    }

    /** run 启动入口收敛（teammate 前瞻 §3）：本阶段仅 USER 走会话内输入条。 */
    fun startRun(source: RunSource, text: String) {
        val cid = _active.value?.conversationId ?: return
        held[cid]?.session?.submit(text)
    }

    fun steer(text: String) {
        held[_active.value?.conversationId ?: return]?.session?.steer(text)
    }

    fun stop() {
        held[_active.value?.conversationId ?: return]?.session?.stop()
    }

    /** 本地裁决：gate 先到者生效 + server 上报（幂等 409 吞）。 */
    fun resolveApproval(requestId: String, approved: Boolean, comment: String?) {
        val cid = _active.value?.conversationId ?: return
        val conv = held[cid] ?: return
        val decision = if (approved) ApprovalDecision.Approve else ApprovalDecision.Reject(comment)
        conv.gate.resolve(requestId, decision)
        scope.launch { runCatching { conv.channel.resolve(requestId, decision, comment) } }
    }

    /** GlobalChannel 的 approval_resolved 路由到对应会话 gate（跨端裁决）。 */
    fun routeApprovalResolved(event: ServerEvent.ApprovalResolved) {
        held[event.conversationId]?.let { it.channel.onSseResolved(event, it.gate) }
    }

    /** SSE lease_released（holder 释放）→ 只读态回 Idle。 */
    fun onLeaseReleased() = leaseCoordinator.onLeaseReleased()

    /** ChatSideChannels：只读「接续」= 重取租约（ReadOnly/Lost 均可），成功转持有装配。 */
    override suspend fun resumeLease() {
        val act = _active.value ?: return
        when (leaseCoordinator.resume(act.conversationId)) {
            is LeaseState.Holder -> attachHolder(act.conversationId, act.projectId)
            else -> Unit // ReadOnly：冲突框已由 LeaseCoordinator 经 oneShots 发出
        }
    }

    suspend fun loadOlder(): nova.agent.app.data.OlderPage? {
        val act = _active.value ?: return null
        val history: List<StoredRun> = if (!act.readOnly) {
            held[act.conversationId]?.session?.history() ?: return null
        } else {
            rowsToRuns(replayCache[act.conversationId] ?: return null)
        }
        val page = paging.nextPage(history, act.conversationId) ?: return null
        return nova.agent.app.data.OlderPage(page.prepend, page.hasMore)
    }

    /** FGS/onTaskRemoved 的优雅退场：停 run 落 ABORTED → release → 停 SSE。 */
    fun onKeepAliveLost() {
        stopAllRuns()
        scope.launch { closeAll() }
    }

    fun stopAllRuns() {
        held.values.forEach { it.session.stop() }
    }

    /** 会话关闭/登出：全量释放。 */
    suspend fun closeAll() {
        held.values.forEach { it.relayJob.cancel(); runCatching { it.session.shutdown() } }
        held.clear()
        watchers.values.forEach { w ->
            w.collectorJob.cancel()
            runCatching { w.bridge.stop() }
        }
        watchers.clear()
        leaseCoordinator.release()
        _active.value = null
        _running.value = false
        _sessionState.value = null
        _watchActive.value = false
        paging = HistoryPaging()
    }

    /** FGS 谓词输入：任一持有会话活跃 run 或当前 Watcher 存在。 */
    val hasBackgroundWork: Boolean get() = held.isNotEmpty() || watchers.isNotEmpty()

    // ---- 持有分支 ----

    private suspend fun attachHolder(cid: String, projectId: String?) {
        parkCurrent()
        var conv = held[cid]
        if (conv == null) {
            conv = buildHeld(cid, projectId)
            held[cid] = conv
        } else {
            // 后台会话重新附着：盯一次积压（重附着前离线积压的补推可见化）
            watchPendingDrain(cid, null)
        }
        conv.relayJob = scope.launch { conv.session.events.collect { _events.tryEmit(it) } }
        scope.launch {
            conv.session.state.collect { s ->
                _sessionState.value = s
                _running.value = s is SessionState.Running || s is SessionState.WaitingApproval
            }
        }
        _active.value = Active(cid, projectId, readOnly = false)
        emitInitialHistory(cid, conv)
        registry.updateAfterOpen(cid, JournalMirror.readMirrorTail(registry.mirrorPath(cid)).gs)
    }

    private suspend fun buildHeld(cid: String, projectId: String?): Held {
        val definition = runCatching { loadDefinition() }.getOrNull()
        val store = RemoteNovelStore(
            projects = CloudProjectsClient(httpFactory(baseUrl()), authSession),
            projectId = projectId ?: "",
            sessionTag = RemoteNovelStore.newSessionTag(cid),
            getLeaseToken = leaseCoordinator.token,
            getConversationId = { cid },
            cachePath = registry.mirrorPath(cid).resolveSibling("domain-snapshot.json"),
            io = io,
        )
        store.init()
        val journal = HttpJournalStore(
            http = httpFactory(baseUrl()),
            conversationId = cid,
            auth = authSession,
            getLeaseToken = leaseCoordinator.token,
            pending = pendingQueue,
            mirrorPath = registry.mirrorPath(cid),
            io = io,
            clock = clock,
        )
        val channel = ServerApprovalChannel(httpFactory(baseUrl()), authSession)
        val gate = channel.gate(
            conversationId = { cid },
            leaseToken = leaseCoordinator.token,
        )
        val session = AgentSession(
            conversationId = cid,
            provider = LazyProvider(providerFactory),
            tools = novelTools(store),
            journal = journal,
            approvalGate = gate,
            definition = definition,
            definitionCaps = definitionCaps,
            onRecovered = { calls ->
                _pills.tryEmit("已补完重启前 ${calls.size} 个悬挂工具调用（结果已落账本）")
            },
            clock = clock,
        )
        // open() 的 drain 与 start() 异步竞态：先取积压基数再启动（drain 完成早于首拍也能出 pill）
        val pendingBefore = pendingQueue.count(cid)
        session.start()
        if (pendingBefore > 0) watchPendingDrain(cid, pendingBefore)
        return Held(session, gate, channel, store, relayJob = Job())
    }

    /** 首屏/重附着：最新 N run 全量投影（事件流 replay 缓冲保证订阅即得）。 */
    private suspend fun emitInitialHistory(cid: String, conv: Held) {
        val history = conv.session.history()
        history.sortedByDescending { it.runSeq }.take(HISTORY_FIRST_PAGE).sortedBy { it.runSeq }.forEach { run ->
            JournalProjector.runEvents(cid, run).forEach { _events.emit(it) }
        }
    }

    /** 断线积压补推可见化（FR10）：drain 窗口内计数下降 → SysPill；seed 为 start 前基数（竞态安全）。 */
    private fun watchPendingDrain(cid: String, seed: Int?) {
        scope.launch {
            var seen = seed ?: pendingQueue.count(cid)
            if (seen == 0) return@launch
            val deadline = clock() + 15_000
            while (isActive && clock() < deadline) {
                delay(500)
                val nowCount = pendingQueue.count(cid)
                if (nowCount < seen) {
                    _pills.tryEmit("已补推 ${seen - nowCount} 条离线积压事件")
                    seen = nowCount
                }
                if (nowCount == 0) break
            }
        }
    }

    // ---- 只读分支 ----

    private fun attachWatcher(cid: String, projectId: String?) {
        parkCurrent()
        var watch = watchers[cid]
        if (watch == null) {
            val tail = JournalMirror.readMirrorTail(registry.mirrorPath(cid)).gs
            val bridge = SseBridge(baseUrl(), cid, authSession, initialSince = tail, io = io)
            watch = Watch(bridge, collectorJob = Job())
            watchers[cid] = watch
            // 首屏投影走全量 replay（since=0）——本地镜像有内容但 UI 状态为空时才能完整复刻；
            // SSE 流仍从 tail 起订阅，事件级重复由 reducer 的 u-r/a-<runSeq> 幂等吸收
            scope.launch { initialReplay(cid, 0) }
        }
        watch.collectorJob = scope.launch { watch.bridge.events.collect { onWatcherEvent(cid, it) } }
        watch.bridge.start(scope)
        _watchActive.value = true
        _active.value = Active(cid, projectId, readOnly = true)
    }

    private fun onWatcherEvent(cid: String, ev: ServerEvent) {
        when (ev) {
            is ServerEvent.Journal -> {
                watchSeq.value = ev.seq
                val rows = replayCache.getOrPut(cid) { mutableListOf() }
                rows.add(ReplayRow(seq = ev.seq, conversationId = cid, runSeq = ev.runSeq, kind = ev.kind, payload = ev.payload.toString()))
                val messages = JournalProjector.parseMessages(ev.payload)
                JournalProjector.rowEvents(cid, ev.runSeq, ev.kind, messages).forEach { _events.tryEmit(it) }
                emitRunEndIfTerminal(cid, ev.runSeq)
                scope.launch { registry.updateAfterOpen(cid, ev.seq) }
            }
            is ServerEvent.ApprovalRequested -> {
                _events.tryEmit(LoopEvent.ApprovalRequested(cid, ev.runSeq, ev.requestId, parseToolCalls(ev.calls)))
            }
            is ServerEvent.ApprovalResolved -> {
                _events.tryEmit(LoopEvent.ApprovalResolved(cid, 0, ev.requestId, ev.decision, ev.comment))
            }
            is ServerEvent.JournalRewritten -> {
                // 游标归零全量补拉在 SseBridge 内建；缓存同步清空重拉
                replayCache[cid]?.clear()
                scope.launch { initialReplay(cid, 0) }
            }
            else -> Unit
        }
    }

    private suspend fun initialReplay(cid: String, since: Long) {
        val token = authSession.ensureAccessToken() ?: return
        val resp = fetchReplay(httpFactory(baseUrl()), cid, token, since = since, io = io) ?: return
        val rows = replayCache.getOrPut(cid) { mutableListOf() }
        if (since == 0L) rows.clear()
        rows.addAll(resp.events)
        resp.events.sortedBy { it.seq }.forEach { row ->
            val messages = JournalProjector.parseMessages(Json.parseToJsonElement(row.payload))
            JournalProjector.rowEvents(cid, row.runSeq, row.kind, messages).forEach { _events.tryEmit(it) }
            emitRunEndIfTerminal(cid, row.runSeq)
        }
        registry.updateAfterOpen(cid, resp.lastSeq)
    }

    /** 行级终判合成 RunEnd（runEvents 有整 run 视图，行路径靠缓存折叠；每 run 只播一次）。 */
    private fun emitRunEndIfTerminal(cid: String, runSeq: Int) {
        if (runSeq in announcedRuns) return
        val runRows = replayCache[cid].orEmpty().filter { it.runSeq == runSeq }.sortedBy { it.seq }
        if (runRows.none { it.kind == "snapshot" }) return // run 未开号，防御
        val messages = runRows.flatMap { JournalProjector.parseMessages(Json.parseToJsonElement(it.payload)) }
        val terminal = JournalProjector.terminalOf(messages) ?: return
        announcedRuns += runSeq
        _events.tryEmit(LoopEvent.RunEnd(cid, runSeq, nova.agent.loop.RunEndReason.COMPLETED, finalContent = terminal))
    }

    // ---- 公用 ----

    /** 切换：当前会话 park（心跳/journal/SSE 存续，UI 中继断开）。 */
    private fun parkCurrent() {
        _active.value?.let { act ->
            held[act.conversationId]?.relayJob?.cancel()
            watchers[act.conversationId]?.collectorJob?.cancel()
        }
        _sessionState.value = null
        _watchActive.value = false
    }

    private fun rowsToRuns(rows: List<ReplayRow>): List<StoredRun> {
        val runs = LinkedHashMap<Int, StoredRun>()
        rows.sortedBy { it.seq }.forEach { row ->
            val messages = JournalProjector.parseMessages(Json.parseToJsonElement(row.payload))
            runs.getOrPut(row.runSeq) { StoredRun(row.runSeq) }.append(messages)
        }
        return runs.values.toList()
    }

    companion object {
        const val HISTORY_FIRST_PAGE = 8
    }
}
