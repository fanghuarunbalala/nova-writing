package nova.agent.session

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import nova.agent.approval.ApprovalGate
import nova.agent.compact.CompactionConfig
import nova.agent.compact.CompactPolicyChain
import nova.agent.compact.defaultPolicies
import nova.agent.journal.JournalStore
import nova.agent.journal.Recovery
import nova.agent.loop.AgentLoop
import nova.agent.loop.AgentLoopConfig
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import nova.agent.provider.Provider
import nova.agent.tool.ToolDef
import nova.agent.tool.ToolDispatcher
import nova.agent.tool.ToolRegistry
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.atomic.AtomicInteger

/**
 * 会话状态（M4 的 UI 数据源：Running → 进度条、WaitingApproval → BottomSheet+通知、Done → 收口展示）。
 */
sealed interface SessionState {
    data object Idle : SessionState
    data class Running(val runSeq: Int) : SessionState
    data class WaitingApproval(val requestId: String, val calls: List<ToolCall>) : SessionState
    data class Done(val runSeq: Int, val reason: RunEndReason, val finalContent: String?) : SessionState
}

/**
 * run lane 输入队列：FIFO 排队；stop() 时可清空（对齐桌面端 inbox run lane 语义）。
 * 为什么不用 Channel：Channel 无法选择性丢弃待处理的 run 输入。
 */
class LoopInbox {
    private val queue = ConcurrentLinkedDeque<String>()
    private val wake = Channel<Unit>(Channel.CONFLATED)

    val size: Int get() = queue.size

    fun submit(text: String) {
        queue.addLast(text)
        wake.trySend(Unit)
    }

    fun clearPending() {
        queue.clear()
    }

    suspend fun receive(): String {
        while (true) {
            queue.pollFirst()?.let { return it }
            wake.receive()
        }
    }
}

/**
 * AgentSession：一个会话一个总作用域（桌面端 Conversation 的进程内对应物）。
 *
 * M4 挂载点：界面销毁生成不中断 → 会话 scope 挂在 AgentForegroundService 的 scope
 * 而不是 ViewModel scope；SavedStateHandle 取回 conversationId → journal 重放恢复现场。
 */
class AgentSession(
    val conversationId: String,
    provider: Provider,
    tools: List<ToolDef>,
    private val journal: JournalStore,
    val approvalGate: ApprovalGate = ApprovalGate(),
    compactionConfig: CompactionConfig = CompactionConfig(),
    loopConfig: AgentLoopConfig = AgentLoopConfig(),
    summarizer: suspend (String) -> String = { text ->
        "（M1 确定性摘要占位，原文 ${text.length} 字）" + text.take(200)
    },
    private val systemPrompt: suspend () -> String = { "你是网文创作助手 Nova，人主导创作，AI 辅助推进。" },
    model: String = "default",
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val clock: () -> Long = System::currentTimeMillis,
    /** 定义包（M2）：存在时压缩参数/审批覆盖由包装配，definitionVersion 落 journal。 */
    private val definition: nova.agent.definition.DefinitionBundle? = null,
    private val definitionCaps: nova.agent.definition.DefinitionAssembler.Capabilities? = null,
) {
    val scope = CoroutineScope(
        SupervisorJob() + dispatcher + CoroutineName("agent-session-$conversationId")
    )

    private val _events = MutableSharedFlow<LoopEvent>(extraBufferCapacity = 512)
    val events: SharedFlow<LoopEvent> = _events.asSharedFlow()

    private val _state = MutableStateFlow<SessionState>(SessionState.Idle)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    val inbox = LoopInbox()
    private val steerChannel = Channel<String>(Channel.UNLIMITED)

    private val registry = ToolRegistry().apply {
        val assembler = definition?.let { nova.agent.definition.DefinitionAssembler(it) }
        val effective = assembler?.applyToolPolicy(tools) ?: tools
        effective.forEach { register(it) }
    }
    private val toolDispatcher = ToolDispatcher(registry)
    private val effectiveCompactionConfig = definition
        ?.let { nova.agent.definition.DefinitionAssembler(it).toCompactionConfig() }
        ?: compactionConfig
    private val chain = CompactPolicyChain(journal, effectiveCompactionConfig, defaultPolicies(effectiveCompactionConfig, summarizer))
    private val loop = AgentLoop(
        conversationId = conversationId,
        provider = provider,
        dispatcher = toolDispatcher,
        journal = journal,
        approvalGate = approvalGate,
        chain = chain,
        events = _events,
        systemPrompt = systemPrompt,
        config = loopConfig,
        model = model,
        clock = clock,
        steerSignals = steerChannel,
        definitionVersion = definition?.definitionVersion,
    )

    private val seqCounter = AtomicInteger(0)
    private val runs = mutableListOf<StoredRun>()
    private var drainJob: Job? = null

    init {
        // 能力校验 fail-fast：包引用了端不支持的 renderer/policy/nudge/组 → 拒绝构造（回退缓存旧包由调用方处理）
        if (definition != null && definitionCaps != null) {
            val missing = nova.agent.definition.DefinitionAssembler(definition).validateCapabilities(definitionCaps)
            require(missing.isEmpty()) {
                "端能力不足以装配定义包 ${definition.definitionVersion}，缺失: $missing"
            }
        }
    }

    @Volatile
    private var currentRunJob: Job? = null

    /** 启动会话：journal 打开 → 悬挂调用补完（崩溃恢复）→ drain 循环 + 状态归约。幂等。 */
    fun start() {
        if (drainJob != null) return
        drainJob = scope.launch {
            journal.open()
            runs.clear()
            runs.addAll(journal.readAll())
            Recovery.settlePendingRun(journal, runs)
            while (isActive) {
                val text = inbox.receive()
                val seq = seqCounter.incrementAndGet()
                val job = launch { safeExecuteRun(seq, text) }
                currentRunJob = job
                job.join()
            }
        }
        scope.launch {
            events.collect { e -> _state.value = reduce(e) }
        }
    }

    /** 提交一条用户消息（排队执行，run lane FIFO）。 */
    fun submit(text: String) = inbox.submit(text)

    /** steer：向正在进行的 run 高优先级注入补充说明（下一次请求前生效，之后清扫）。 */
    fun steer(text: String) {
        steerChannel.trySend(text)
    }

    /** 停止：取消当前 run + 清空排队的输入（对齐桌面端 stop = abort + 清 run lane）。 */
    fun stop() {
        inbox.clearPending()
        currentRunJob?.cancel()
    }

    /** 整会话关闭：协程树整棵取消 + journal 关闭。 */
    fun shutdown() {
        scope.cancel()
        journal.close()
    }

    suspend fun history(): List<StoredRun> = journal.readAll()

    private suspend fun safeExecuteRun(seq: Int, text: String) {
        try {
            loop.executeRun(seq, text, runs)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // loop 内部已兜底，这里是防御层：drain 永不因单个 run 失败而死亡
            _events.tryEmit(
                LoopEvent.RunEnd(conversationId, seq, RunEndReason.FAILED, error = "run 异常: ${e.message}")
            )
        }
    }

    private fun reduce(e: LoopEvent): SessionState = when (e) {
        is LoopEvent.RunStart -> SessionState.Running(e.runSeq)
        is LoopEvent.ApprovalRequested -> SessionState.WaitingApproval(e.requestId, e.calls)
        is LoopEvent.ApprovalResolved -> SessionState.Idle
        is LoopEvent.RunEnd -> SessionState.Done(e.runSeq, e.reason, e.finalContent)
        else -> _state.value
    }
}
