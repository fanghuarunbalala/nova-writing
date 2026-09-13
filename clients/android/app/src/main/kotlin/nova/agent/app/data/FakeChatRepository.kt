package nova.agent.app.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nova.agent.loop.LoopEvent
import nova.agent.loop.RunEndReason
import nova.agent.model.LLMessage
import nova.agent.model.ToolCall
import kotlin.math.ceil

/**
 * 演示仓库：按 DemoScript 时间轴协程回放 LoopEvent（等价 demo HTML 的状态重放）。
 *
 * - events 用 replay 缓冲：VM 晚订阅也能拿到 init 时零延时回放的历史；
 *   重复消费由 reducer 的 id 幂等保证收敛（u-r、a-、t-、s- 前缀去重）。
 * - 可测性注入：sleep（默认真 delay，测试传虚拟时钟桩）。
 */
class FakeChatRepository(
    private val scope: CoroutineScope,
    private val script: DemoScript = DemoScript(),
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) : ChatRepository {

    private val _events = MutableSharedFlow<LoopEvent>(replay = 256, extraBufferCapacity = 256)
    override val events: SharedFlow<LoopEvent> = _events

    private val _running = MutableStateFlow(false)
    override val running: StateFlow<Boolean> = _running

    override val sessionSubtitle: String get() = script.sessionSubtitle
    override val sessionMeta: String get() = script.sessionMeta

    private var runSeq = 0
    private val queue = ArrayDeque<String>()
    private var job: Job? = null
    private var olderSegmentsLeft = 2
    private var approvalGate: CompletableDeferred<Pair<Boolean, String?>>? = null
    private var approvalRequestId: String? = null

    /** demo 首屏进行中的工具行（NovelWrite RUN 态）；下次 run 开始时以「提请审批」收口 */
    private var danglingTool: ToolCall? = null

    init {
        scope.launch { replayHistory() }
    }

    private suspend fun replayHistory() {
        script.history.forEachIndexed { i, run ->
            val seq = i + 1
            runSeq = seq
            emit(LoopEvent.RunStart(script.conversationId, seq))
            emit(LoopEvent.UserMessage(script.conversationId, seq, run.userText))
            run.tools.forEachIndexed { ti, tool ->
                val callId = "h-$seq-tool-$ti"
                emit(LoopEvent.ToolCallRequest(script.conversationId, seq, ToolCall(callId, tool.name)))
                emit(
                    LoopEvent.ToolCallResponse(
                        script.conversationId, seq,
                        toolCallId = callId, name = tool.name, content = tool.summary,
                    ),
                )
            }
            if (run.runningTool != null) {
                // demo 首屏快照：NovelWrite 进行中 + 草稿已流出（五态条停在「生成中」），未收口
                val call = ToolCall("call-run-47", run.runningTool.name)
                danglingTool = call
                emit(LoopEvent.ToolCallRequest(script.conversationId, seq, call))
                emit(LoopEvent.AssistantDelta(script.conversationId, seq, script.draftText))
            } else {
                emit(
                    LoopEvent.AssistantMessage(
                        script.conversationId, seq,
                        LLMessage.Assistant(content = run.assistantText.orEmpty()),
                    ),
                )
                emit(LoopEvent.RunEnd(script.conversationId, seq, RunEndReason.COMPLETED))
            }
        }
    }

    override fun roundLabelFor(runSeq: Int): String? = script.roundLabelFor(runSeq)

    private suspend fun emit(event: LoopEvent) {
        _events.emit(event)
    }

    override fun submit(text: String) {
        if (_running.value) {
            queue += text
        } else {
            startRun()
        }
    }

    private fun startRun() {
        _running.value = true
        job = scope.launch {
            val self = coroutineContext[Job]!!
            var seq = ++runSeq
            try {
                // demo run #47 的接续：先收掉首屏悬挂的 NovelWrite 行（「第 2 章 · 追逃段 · 提请审批」）
                danglingTool?.let { call ->
                    danglingTool = null
                    emit(
                        LoopEvent.ToolCallResponse(
                            script.conversationId, seq - 1,
                            toolCallId = call.id, name = call.name,
                            content = "第 2 章 · 追逃段 · 提请审批",
                        ),
                    )
                }
                playRun(seq)
            } catch (e: kotlinx.coroutines.CancellationException) {
                withContext(NonCancellable) {
                    // stop() 后五态条复位：RunEnd(ABORTED) 照常上流
                    _events.emit(LoopEvent.RunEnd(script.conversationId, seq, RunEndReason.ABORTED))
                }
                throw e
            } finally {
                withContext(NonCancellable) {
                    _running.value = false
                    // 收口后自动接续排队提交（幽灵晋升的驱动源）；取消/stop 清队后自然停
                    if (!self.isCancelled) queue.removeFirstOrNull()?.let { startRun() }
                }
            }
        }
    }

    private suspend fun playRun(seq: Int) {
        val cid = script.conversationId
        // 首个提交的用户消息已由 Submitted 即时上屏；不回发 UserMessage（与交互路径以 id 幂等）
        emit(LoopEvent.RunStart(cid, seq))

        // 思考窗口（启发式：RunStart → 首个 delta 之间）
        sleep(script.thinkingMs)

        // 打字机：累计文本 32ms 节奏切片（≈ runtime DeltaCoalescer 语义）
        val draft = script.draftText
        val step = ceil(draft.length.toDouble() / script.deltaTicks).toInt().coerceAtLeast(1)
        var pos = 0
        while (pos < draft.length) {
            pos = minOf(pos + step, draft.length)
            emit(LoopEvent.AssistantDelta(cid, seq, draft.substring(0, pos)))
            sleep(script.deltaTickMs)
        }
        sleep(200)

        // 工具调用（3 型审批卡 → 3 条工具行）
        script.approvalCalls.forEach { call ->
            emit(LoopEvent.ToolCallRequest(cid, seq, call))
            sleep(120)
        }
        sleep(280)

        // 审批征询（120s 窗口由 VM 倒计时；此处等待裁决）。批次 id 对齐 demo；
        // 后续 run 追加序号避免与已留痕的 b2 批次 id 幂等冲突
        val requestId = if (seq == 3) script.approvalRequestId else "${script.approvalRequestId}-r$seq"
        approvalRequestId = requestId
        val gate = CompletableDeferred<Pair<Boolean, String?>>()
        approvalGate = gate
        emit(LoopEvent.ApprovalRequested(cid, seq, requestId, script.approvalCalls))
        val (approved, comment) = gate.await()
        approvalGate = null
        approvalRequestId = null
        emit(LoopEvent.ApprovalResolved(cid, seq, requestId, if (approved) "approve" else "reject", comment))

        if (approved) {
            sleep(600)
            script.approvalCalls.forEach { call ->
                emit(
                    LoopEvent.ToolCallResponse(
                        cid, seq,
                        toolCallId = call.id, name = call.name,
                        content = when (call.name) {
                            "NovelEdit" -> "角色档案 v3 已写入"
                            "NovelWrite" -> "正文草稿已生成 · 待转入正式稿"
                            else -> "地点卡已移除 · 废弃渡口碑"
                        },
                    ),
                )
                sleep(150)
            }
            sleep(300)
            emit(
                LoopEvent.AssistantMessage(
                    cid, seq,
                    LLMessage.Assistant(content = script.finalText, reasoning = script.reasoning),
                ),
            )
            sleep(100)
            emit(LoopEvent.RunEnd(cid, seq, RunEndReason.COMPLETED))
        } else {
            sleep(300)
            emit(LoopEvent.RunEnd(cid, seq, RunEndReason.ABORTED))
        }
    }

    override fun stop() {
        queue.clear()
        approvalGate?.complete(Pair(false, null))
        job?.cancel()
    }

    /** 演示触发器：生成失败（demo fail 重放——provider 超时 + FailedRetry 重试链） */
    override fun injectDemoFailure() {
        scope.launch {
            job?.cancel()
            danglingTool = null
            _events.emit(
                LoopEvent.RunEnd(
                    script.conversationId, runSeq,
                    reason = RunEndReason.FAILED,
                    error = "provider 超时（120s）：上游无响应",
                ),
            )
        }
    }

    override fun resolveApproval(requestId: String, approved: Boolean, comment: String?) {
        if (requestId != approvalRequestId) return
        approvalGate?.complete(Pair(approved, comment))
    }

    override suspend fun loadOlder(): OlderPage? {
        if (olderSegmentsLeft <= 0) return null
        val seg = 2 - olderSegmentsLeft
        olderSegmentsLeft--
        sleep(350) // 假装网络往返
        // 段0 = demo「第 1 轮 · 开卷核对」1 轮；段1 = 模板归档 7 轮 → 剩余口径对齐 demo「剩 8 轮」
        return OlderPage(
            prepend = olderSegment(seg),
            hasMore = olderSegmentsLeft > 0,
            remainingRuns = olderSegmentsLeft * 7,
        )
    }
}
