package nova.agent.loop

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeoutOrNull
import nova.agent.approval.ApprovalDecision
import nova.agent.approval.ApprovalGate
import nova.agent.approval.ApprovalRequest
import nova.agent.compact.CompactPolicyChain
import nova.agent.model.FinishReason
import nova.agent.model.LLMessage
import nova.agent.model.SamplingConfig
import nova.agent.model.StoredRun
import nova.agent.model.ToolCall
import nova.agent.model.Usage
import nova.agent.provider.DeltaType
import nova.agent.provider.Provider
import nova.agent.provider.ProviderException
import nova.agent.provider.ProviderRequest
import nova.agent.journal.JournalStore
import nova.agent.tool.ToolContext
import nova.agent.tool.ToolDispatcher
import nova.agent.tool.ToolErrorCode
import nova.agent.tool.ToolException

data class AgentLoopConfig(
    val maxTurns: Int = 100,
    val toolTimeoutMs: Long = 60_000,
    val deltaCoalesceMs: Long = 32,
    /** 测试/演示用：审批门直通（等价桌面端 bypass 模式）。 */
    val approvalBypass: Boolean = false,
)

/**
 * AgentLoop：ReAct 循环本体（桌面端 core/src/runtime/loop/AgentLoop.ts 的协程版）。
 *
 * run = 一次用户消息驱动的完整周期（user → N×turn → final assistant），journal 落盘单位；
 * turn = 一次 provider 请求及其工具收口。
 *
 * 协程结构：executeRun 运行在会话 drain 协程的子 job 里——
 * 取消沿树传播（正在流式的请求一起断干净）；工具批 supervisorScope + async×N 并行等齐、
 * 失败就地 catch 转结构化反馈，不连坐取消循环。
 */
class AgentLoop(
    private val conversationId: String,
    private val provider: Provider,
    private val dispatcher: ToolDispatcher,
    private val journal: JournalStore,
    private val approvalGate: ApprovalGate,
    private val chain: CompactPolicyChain,
    private val events: kotlinx.coroutines.flow.MutableSharedFlow<LoopEvent>,
    private val systemPrompt: suspend () -> String,
    private val config: AgentLoopConfig = AgentLoopConfig(),
    val model: String = "default",
    val sampling: SamplingConfig = SamplingConfig(),
    val maxTokens: Int? = null,
    private val clock: () -> Long = System::currentTimeMillis,
    private val steerSignals: ReceiveChannel<String>? = null,
    /** 本 run 装配所用的定义包版本（落 journal snapshot 行，重放解释的溯源标记）。 */
    private val definitionVersion: String? = null,
) {
    private var batchSeq = 0

    /**
     * 执行一个 run。runs 为调用方持有的历史 run 列表，本方法把当前 run 追加进去
     * （压缩与 rewriteAll 因此直接作用于调用方的列表，journal 与内存保持一致）。
     */
    suspend fun executeRun(
        runSeq: Int,
        userText: String,
        runs: MutableList<StoredRun>,
    ): RunResult {
        val currentRun = StoredRun(runSeq, mutableListOf(LLMessage.User(userText)))
        runs.add(currentRun)
        val ctx = LoopContext(runSeq, runs, model, sampling, maxTokens)

        journal.appendSnapshot(runSeq, currentRun.messages.toList(), definitionVersion)
        emit(LoopEvent.RunStart(conversationId, runSeq))
        emit(LoopEvent.UserMessage(conversationId, runSeq, userText))

        var usage = Usage()
        try {
            for (turn in 1..config.maxTurns) {
                // 每轮开始先响应取消（桌面端 drain 前置 abort 检查的对应物）
                currentCoroutineContext().ensureActive()
                ctx.sweepNudges()
                injectSteer(ctx, runSeq)
                chain.compactIfNeeded(ctx)?.let { emit(LoopEvent.Compacted(conversationId, runSeq, it)) }

                val request = ctx.toProviderRequest(systemPrompt(), dispatcher.schemas())
                val textSoFar = StringBuilder()
                val coalescer = DeltaCoalescer(config.deltaCoalesceMs, clock) { chunk ->
                    textSoFar.append(chunk)
                    emit(LoopEvent.AssistantDelta(conversationId, runSeq, textSoFar.toString()))
                }
                var reasoningChars = 0
                val result = callProviderWithFuse(ctx, request) { delta ->
                    when (delta.type) {
                        DeltaType.TEXT -> coalescer.add(delta.text)
                        DeltaType.REASONING -> reasoningChars += delta.text.length
                    }
                }
                coalescer.flush()
                usage += result.usage ?: Usage()

                ctx.appendCurrent(listOf(result.message))
                journal.appendMessages(runSeq, listOf(result.message))

                if (result.finishReason != FinishReason.TOOL_CALL) {
                    emit(LoopEvent.AssistantMessage(conversationId, runSeq, result.message))
                    emit(
                        LoopEvent.RunEnd(
                            conversationId, runSeq, RunEndReason.COMPLETED,
                            finishReason = result.finishReason,
                            finalContent = result.message.content,
                            usage = usage,
                        )
                    )
                    return RunResult(runSeq, RunEndReason.COMPLETED, result.message.content, usage)
                }

                // 工具收口：审批门（先于任何执行）→ 并行执行 → 按调用顺序回填
                val decision = gateBatch(runSeq, result.toolCalls)
                val toolMessages = executeToolBatch(runSeq, result.toolCalls, decision)
                ctx.appendCurrent(toolMessages)
                journal.appendMessages(runSeq, toolMessages)
            }
            emit(LoopEvent.RunEnd(conversationId, runSeq, RunEndReason.MAX_TURNS, usage = usage))
            return RunResult(runSeq, RunEndReason.MAX_TURNS, usage = usage)
        } catch (e: CancellationException) {
            // 对齐桌面端：abort 后静默收口（已完成的 turn 全在 journal，重放可恢复）
            events.tryEmit(LoopEvent.RunEnd(conversationId, runSeq, RunEndReason.ABORTED, usage = usage))
            throw e
        } catch (e: ProviderException) {
            val msg = "模型调用失败(${e.kind}): ${e.message}"
            emit(LoopEvent.RunEnd(conversationId, runSeq, RunEndReason.FAILED, error = msg, usage = usage))
            return RunResult(runSeq, RunEndReason.FAILED, usage = usage, error = msg)
        } catch (e: Exception) {
            val msg = "run 异常终止: ${e::class.simpleName}: ${e.message}"
            emit(LoopEvent.RunEnd(conversationId, runSeq, RunEndReason.FAILED, error = msg, usage = usage))
            return RunResult(runSeq, RunEndReason.FAILED, usage = usage, error = msg)
        }
    }

    /** 超窗保险丝：CONTEXT_LENGTH 错误 → forceCompact（跳过阈值门）→ 重组装重试一次。 */
    private suspend fun callProviderWithFuse(
        ctx: LoopContext,
        request: ProviderRequest,
        onDelta: suspend (nova.agent.provider.ProviderDelta) -> Unit,
    ): nova.agent.provider.ProviderResult {
        return try {
            provider.call(request, onDelta)
        } catch (e: ProviderException) {
            if (!e.isContextLength) throw e
            chain.force(ctx)
            val rebuilt = ctx.toProviderRequest(systemPrompt(), dispatcher.schemas())
            provider.call(rebuilt, onDelta)
        }
    }

    /** 审批门：本批 requireApproval 的调用合并一次征询（bypass 直通）。 */
    private suspend fun gateBatch(runSeq: Int, calls: List<ToolCall>): ApprovalDecision {
        if (config.approvalBypass) return ApprovalDecision.Approve
        val needApproval = calls.filter { dispatcher.requiresApproval(it.name) }
        if (needApproval.isEmpty()) return ApprovalDecision.Approve
        val requestId = "approval:$conversationId:$runSeq:b${batchSeq++}"
        emit(LoopEvent.ApprovalRequested(conversationId, runSeq, requestId, needApproval))
        val decision = approvalGate.await(ApprovalRequest(requestId, conversationId, runSeq, needApproval))
        val comment = (decision as? ApprovalDecision.Reject)?.comment
        emit(LoopEvent.ApprovalResolved(conversationId, runSeq, requestId, decision.label, comment))
        return decision
    }

    /** 工具批：supervisorScope 隔离失败；async×N 并行执行、awaitAll 保序回填。 */
    private suspend fun executeToolBatch(
        runSeq: Int,
        calls: List<ToolCall>,
        decision: ApprovalDecision,
    ): List<LLMessage.Tool> = supervisorScope {
        calls.map { call -> async { executeOne(runSeq, call, decision) } }.awaitAll()
    }

    private suspend fun executeOne(
        runSeq: Int,
        call: ToolCall,
        decision: ApprovalDecision,
    ): LLMessage.Tool {
        if (decision is ApprovalDecision.Reject && dispatcher.requiresApproval(call.name)) {
            val text = "用户已拒绝该工具调用" +
                (decision.comment?.takeIf { it.isNotBlank() }?.let { "：$it" } ?: "")
            emit(LoopEvent.ToolCallResponse(conversationId, runSeq, call.id, call.name, error = text))
            return LLMessage.Tool(call.id, call.name, text, isError = true)
        }
        emit(LoopEvent.ToolCallRequest(conversationId, runSeq, call))
        val content = try {
            withTimeoutOrNull(config.toolTimeoutMs) {
                dispatcher.dispatch(call, ToolContext(conversationId, runSeq))
            } ?: throw ToolException(ToolErrorCode.HANDLER_FAILED, "工具执行超时（${config.toolTimeoutMs / 1000}s）")
        } catch (e: CancellationException) {
            throw e
        } catch (e: ToolException) {
            return failed(call, runSeq, "工具执行失败(${e.code}): ${e.message}")
        } catch (e: Exception) {
            return failed(call, runSeq, "工具执行失败(${ToolErrorCode.HANDLER_FAILED}): ${e.message}")
        }
        emit(LoopEvent.ToolCallResponse(conversationId, runSeq, call.id, call.name, content = content))
        return LLMessage.Tool(call.id, call.name, content)
    }

    private suspend fun failed(call: ToolCall, runSeq: Int, text: String): LLMessage.Tool {
        emit(LoopEvent.ToolCallResponse(conversationId, runSeq, call.id, call.name, error = text))
        return LLMessage.Tool(call.id, call.name, text, isError = true)
    }

    /** steer 信号注入为 nudge system 消息（下一次请求消费后清扫，对齐桌面端 control lane）。 */
    private suspend fun injectSteer(ctx: LoopContext, runSeq: Int) {
        while (true) {
            val s = steerSignals?.tryReceive()?.getOrNull() ?: break
            val msg = LLMessage.System("【用户补充】$s", nudge = true)
            ctx.appendCurrent(listOf(msg))
            journal.appendMessages(runSeq, listOf(msg))
        }
    }

    private suspend fun emit(e: LoopEvent) {
        events.emit(e)
    }
}
