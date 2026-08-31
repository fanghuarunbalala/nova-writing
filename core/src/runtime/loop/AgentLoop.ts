import type {
  AssistantMessage,
  LLMessage,
  ProviderResult,
  ToolCall,
} from "../provider/types.js";
import type {
  AgentLoopConfig,
  AgentLoopResult,
  AgentRunConfig,
  RunContext,
  RunProgress,
  LoopInput,
  LoopEvent,
} from "./types.js";
import type { ToolDispatcher } from "../tool/ToolDispatcher.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";
import { isCanonicalNovelWrite } from "../../conversation/compose/canonicalTools.js";
import { isContextLengthError } from "../provider/errors.js";
import { countRunChars } from "../compact/definitions/auto-compact.js";
import { ToolError } from "../tool/errors.js";
import { LoopContext } from "./LoopContext.js";

/** 缺省最大轮次（每 run 最大 turn 数，防死循环） */
const DEFAULT_MAX_TURNS = 100;

/** text-delta 合并窗口（ms）：相邻 delta 合并为一条事件，压低跨进程传输频率（gui-performance-2 功能点一） */
const DELTA_COALESCE_MS = 32;

/** 思考心跳窗口（ms）：reasoning 只报累计字符数（无内容），1s 一条足够指示活性 */
const REASONING_HEARTBEAT_MS = 1_000;

/** 累积两段 token 用量 */
function addUsage(
  acc: { inputTokens: number; outputTokens: number } | undefined,
  next: { inputTokens: number; outputTokens: number },
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: (acc?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (acc?.outputTokens ?? 0) + next.outputTokens,
  };
}

/**
 * 找出消息序列中缺 tool 结果的 toolCall id（恢复判定：非空才需要 resumePendingRun）。
 * 已收口的 run（每个 toolCall 都有对应 tool 消息）返回空数组——重启后不得重跑。
 */
export function findPendingToolIds(messages: readonly LLMessage[]): string[] {
  const toolCallIds = messages.flatMap((m) =>
    m.role === "assistant" ? (m.toolCalls ?? []).map((tc) => tc.id) : [],
  );
  return toolCallIds.filter((id) => !messages.some((m) => m.role === "tool" && m.id === id));
}

/** AgentLoop：agent 主循环，产出 LoopEvent（持久化域 + 流域单流），带输入队列 */
export class AgentLoop {
  /** 构造配置 */
  private readonly config: AgentLoopConfig;
  /** 会话上下文（构造时初始化，由 AgentCapability 组装） */
  private readonly context: LoopContext;
  /** 取消控制器（cancel 触发） */
  private readonly controller = new AbortController();
  /** 审批批次序号（requestId 尾段 b{n}：同 run 多轮工具批次不撞队列幂等） */
  private batchSeq = 0;
  /** delta 合并缓冲（pending 文本 + 所属回调）：任何其他事件发射前先冲刷保序 */
  private pendingDeltaText = "";
  private pendingDeltaOnEvent?: (e: LoopEvent) => void;
  private deltaFlushTimer: ReturnType<typeof setTimeout> | undefined;
  /** 思考心跳：本轮 reasoning 累计字符数（只计数不携内容，1s 节流上报活性） */
  private reasoningChars = 0;
  private reasoningHeartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  /** 输入队列（run 排队 / control 抢占） */
  private inbox: LoopInput[] = [];
  /** 是否正在 drain / run */
  private running = false;
  /** 入队 run 的结果 resolve（resolveId → resolve/reject） */
  private readonly pendingRuns = new Map<string, { resolve: (r: AgentLoopResult) => void; reject: (e: unknown) => void }>();
  /** 输入序号递增 */
  private inputSeq = 0;
  /** 最近一次 run 的 config（followup 无 config 时复用） */
  private lastConfig?: AgentRunConfig;
  /** 输出事件订阅者（持久：run/followup 产出的所有 LoopEvent） */
  private readonly outputListeners = new Set<(e: LoopEvent) => void>();
  /** 压缩发生待发射标记（LoopContext.onCompacted 置位，flushCompacted 冲刷） */
  private pendingCompacted = false;
  /** spawn seed 消息已应用（仅首 run 一次：novel-guide 案例注入） */
  private seedApplied = false;

  /**
   * 构造 AgentLoop
   * @param config 构造配置（workspace + Provider + 能力 + 工具调度 + 恢复消息 + 监听器 + 日志）
   */
  constructor(config: AgentLoopConfig) {
    this.config = config;
    this.context = new LoopContext({
      agentCapability: config.agentCapability,
      workspace: config.workspace,
      runMessages: config.runMessages,
      restoreRuns: config.restoreRuns,
      startSeq: config.startSeq,
      platform: config.platform,
      novelConstraintsProvider: config.novelConstraintsProvider,
      caseGuideProvider: config.caseGuideProvider,
      memoryIndexProvider: config.memoryIndexProvider,
      preCompactPass: config.preCompactPass,
      skillsIndex: config.skillsIndex,
      beforeProviderCall: config.beforeProviderCall,
    });
    // 压缩边界事件桥接：onCompacted 置标记，runTurnLoop / 保险丝路径冲刷为 compacted 事件
    this.context.subscribe({
      onCompacted: () => {
        this.pendingCompacted = true;
      },
    });
    for (const listener of config.listeners ?? []) {
      this.context.subscribe(listener);
    }
  }

  /**
   * 处理一次用户输入：若 idle 立即执行；若 running 入队（串行，当前 run 结束后处理）。
   * @param input 用户消息文本
   * @param runConfig 单次运行配置
   * @param onEvent 输出事件回调（LoopEvent 流）
   * @returns 运行结果
   */
  async run(
    input: string,
    runConfig: AgentRunConfig,
    onEvent?: (e: LoopEvent) => void,
  ): Promise<AgentLoopResult> {
    this.lastConfig = runConfig;
    const run = this.createRun(input);
    if (this.running) {
      // 入队，等当前 run 完成（run 已开，执行时复用）
      return new Promise<AgentLoopResult>((resolve, reject) => {
        const resolveId = `run_${++this.inputSeq}`;
        this.pendingRuns.set(resolveId, { resolve, reject });
        this.inbox.push({ lane: "run", kind: "followup", text: input, run, config: runConfig, onEvent, resolveId });
      });
    }
    return this.runInternal(input, runConfig, onEvent, run);
  }

  /**
   * 追加用户消息（run lane，排队；若 idle 立即 drain）。
   * run 在入队时即时创建（seq 按输入时序分配），执行时复用——上层可同步落盘拿到持久化回执；
   * run-start / user.message 事件延迟到实际执行时发射（不插进正在流式的 run）。
   * @param text 用户消息文本
   * @param runConfig 单次运行配置（缺省复用上次 run 的 config）
   * @returns 新开 run（seq 已分配）
   */
  followup(text: string, runConfig?: AgentRunConfig): RunContext {
    const run = this.createRun(text);
    this.inbox.push({ lane: "run", kind: "followup", text, run, config: runConfig });
    if (!this.running) void this.drain();
    return run;
  }

  /** 转向指令（control lane，高优先级，注入 system reminder） */
  steer(text: string): void {
    this.inbox.push({ lane: "control", kind: "steer", text });
    if (!this.running) void this.drain();
  }

  /** 停止：取消当前 + 清空 run 队列 */
  stop(): void {
    this.controller.abort();
    this.inbox = this.inbox.filter((i) => !(i.lane === "run" && i.kind === "followup"));
  }

  /** 订阅输出事件（run/followup 产出的所有 LoopEvent），返回取消订阅 */
  onOutputEvent(l: (e: LoopEvent) => void): () => void {
    this.outputListeners.add(l);
    return () => this.outputListeners.delete(l);
  }

  /** 工具调度器（投影层缺省 preview resolver 经 resolve(name)?.preview 取用） */
  get toolDispatcher(): ToolDispatcher {
    return this.config.toolDispatcher;
  }

  /**
   * 取消当前 run
   */
  cancel(): void {
    this.controller.abort();
  }

  /** 串行 drain：消费输入队列（control 优先于 run，同 lane FIFO） */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.inbox.length > 0) {
        const input = this.takeNext();
        if (input.kind === "stop") continue;
        if (input.kind === "steer") {
          // 注入 system reminder（转向）
          this.context.appendRunMessages([{ role: "system", content: input.text }]);
          continue;
        }
        // followup（run 已在入队时预开，执行时复用）
        const config = input.config ?? this.lastConfig;
        if (!config) continue;
        if (input.resolveId) {
          try {
            const result = await this.runInternal(input.text, config, input.onEvent, input.run);
            const pending = this.pendingRuns.get(input.resolveId);
            if (pending) {
              pending.resolve(result);
              this.pendingRuns.delete(input.resolveId);
            }
          } catch (e) {
            const pending = this.pendingRuns.get(input.resolveId);
            if (pending) {
              pending.reject(e);
              this.pendingRuns.delete(input.resolveId);
            }
          }
        } else {
          try {
            await this.runInternal(input.text, config, undefined, input.run);
          } catch (e) {
            const run = input.run;
            if (this.controller.signal.aborted) {
              // 用户 stop/cancel：abort 是正常路径，静默收口（不发错误文案）
              this.config.logger?.debug("agent.loop.run.aborted", { seq: run.seq });
              this.emit(undefined, "run-end", { persist: true, seq: run.seq, runSeq: run.seq });
              continue;
            }
            // run 管线异常（provider / 工具 / 监听器）：收口为可见错误，进程继续服务后续消息
            this.config.logger?.error("agent.loop.run.error", {
              seq: run.seq,
              error: e instanceof Error ? e.constructor.name : String(e),
            });
            const text = `（生成失败：${e instanceof Error ? e.message : String(e)}）`;
            this.emit(undefined, "assistant.message", { persist: true, seq: run.seq, text });
            this.emit(undefined, "run-end", { persist: true, seq: run.seq, runSeq: run.seq });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** 取下一个输入：control 优先，同 lane FIFO */
  private takeNext(): LoopInput {
    const controlIdx = this.inbox.findIndex((i) => i.lane === "control");
    if (controlIdx >= 0) {
      const [item] = this.inbox.splice(controlIdx, 1);
      return item!;
    }
    return this.inbox.shift()!;
  }

  /**
   * 实际执行一个 run：先发 run-start / user.message（排队 run 的边界事件在此发射，
   * 保证事件流顺序 = 执行顺序），再循环 toProviderCall / provider.call，
   * 直至 assistant 无 tool_call（final）/ length / maxTurns。
   * @param input 用户消息文本
   * @param runConfig 单次运行配置
   * @param onEvent 输出事件回调
   * @param run 入队时预开的 run（run-start / user.message 在本方法入口发射）
   */
  private async runInternal(
    input: string,
    runConfig: AgentRunConfig,
    onEvent: ((e: LoopEvent) => void) | undefined,
    run: RunContext,
  ): Promise<AgentLoopResult> {
    const logger = this.config.logger;
    // queuedMs：run 开号（createRun，输入时序）→ 实际执行的排队等待（前序 run 占用）
    logger?.info("agent.loop.run.start", {
      inputLen: input.length,
      queuedMs: Date.now() - Date.parse(run.ts),
    });
    this.emitRunOpen(run, input, onEvent);

    // ⓪ spawn seed 消息：仅首 run 一次、首个 provider call 前（novel-guide 案例
    // 正文注入——persistent append，紧随 user 消息；钩子异常吞掉不阻断任务）
    if (this.config.spawnSeedMessages !== undefined && !this.seedApplied) {
      this.seedApplied = true;
      try {
        const seeded = await this.config.spawnSeedMessages(input);
        if (seeded !== undefined && seeded.length > 0) {
          this.context.appendMessagesTo(run, seeded);
        }
      } catch (error) {
        this.config.logger?.debug("agent.loop.seed_failed", {
          failure: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    // ① 由 runConfig 初始化运行进度
    const runProgress: RunProgress = {
      curTurn: 0,
      maxTurn: runConfig.maxTurns ?? DEFAULT_MAX_TURNS,
      toolsLastTurn: new Map(),
    };

    return this.runTurnLoop(run, runConfig, onEvent, runProgress);
  }

  /**
   * 暂停点续跑：恢复 run 中缺 tool 结果的 toolCall 按决策补完（approve 执行 handler /
   * reject「已拒绝」/ expired「审批超时，按拒绝处理」/ 未装配「已拒绝」），
   * 随后继续 provider 循环到 run 收口（事件与 journal 同 seq 重写经 listener 走）。
   * 不发 run-start / user.message（重放已提供边界事件）。
   * @param runConfig 采样配置
   * @returns 运行结果（最终 assistant 消息）
   */
  async resumePendingRun(runConfig: AgentRunConfig): Promise<AgentLoopResult> {
    const run = this.context.runs.at(-1);
    if (run === undefined) throw new Error("无可恢复的 run（journal 为空）");
    // 补完缺 tool 结果的 toolCall（恢复快照里 assistant.toolCalls 无对应 tool 消息的）
    const assistantMessages = run.messages.filter(
      (m) => m.role === "assistant" && m.toolCalls !== undefined && m.toolCalls.length > 0,
    ) as AssistantMessage[];
    const pendingToolIds = findPendingToolIds(run.messages);
    for (const toolCallId of pendingToolIds) {
      const toolCall = assistantMessages
        .flatMap((m) => m.toolCalls!)
        .find((tc) => tc.id === toolCallId)!;
      if (toolCall === undefined) continue;
      const decision = await this.config.resumePendingDecider?.(toolCallId);
      let text: string;
      if (toolCall.name === "AskUserQuestion") {
        // 提问挂起期间重启：答案未回传，不重放提问（会二次打扰）——回填未回答让模型自决
        text =
          "提问因会话重启中断，未获回答；如仍需要作者输入请重新提问，否则基于现有信息继续。";
      } else if (decision === "approve") {
        // 重启补完同样执行 compose 权限检查（approve 分支绕过 gateBatch）
        const compose = this.config.composeState?.snapshot(this.config.conversationId ?? "");
        if (compose?.active === true && isCanonicalNovelWrite(toolCall.name)) {
          text = `已拒绝（设计模式激活：正式稿只读，请将草稿写入 design 文件，不要调用 ${toolCall.name}）`;
        } else {
          text = await this.config.toolDispatcher.dispatch(this.context, toolCall);
        }
      } else if (decision === "reject") {
        text = "已拒绝";
      } else if (decision === "expired") {
        text = "审批超时，按拒绝处理";
      } else {
        text = "已拒绝（审批通道未装配）";
      }
      this.emit(undefined, "tool-call-response", {
        persist: true,
        seq: run.seq,
        toolCallId,
        result: text,
      });
      this.context.appendMessagesTo(run, [{ role: "tool", content: text, id: toolCallId }]);
    }
    const runProgress: RunProgress = {
      curTurn: 0,
      maxTurn: runConfig.maxTurns ?? DEFAULT_MAX_TURNS,
      toolsLastTurn: new Map(),
    };
    return this.runTurnLoop(run, runConfig, undefined, runProgress);
  }

  /** 单 run 的 provider 循环（每轮迭代 = 一次 API 请求 = 一个 turn）：toProviderCall → call → tool 执行/收口，直到 final 或 maxTurns */
  private async runTurnLoop(
    run: RunContext,
    runConfig: AgentRunConfig,
    onEvent: ((e: LoopEvent) => void) | undefined,
    runProgress: RunProgress,
  ): Promise<AgentLoopResult> {
    const logger = this.config.logger;
    const runStartedAt = Date.now();
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for (runProgress.curTurn = 0; runProgress.curTurn < runProgress.maxTurn; runProgress.curTurn++) {
      logger?.debug("agent.call.request", {
        model: runConfig.sampling.model,
        curTurn: runProgress.curTurn,
      });
      // 耗时拆解（debug）：assembleMs = 上下文组装（含压缩）/ providerMs = 模型调用网络耗时；
      // 超窗保险丝：context-length 类错误 → 强制压缩 + 重组装重试一次
      const { result, assembleMs, providerMs, elapsedMs } = await this.callProviderWithFuse(
        run,
        runConfig,
        runProgress,
        onEvent,
      );
      this.context.appendMessagesTo(run, [result.message]);
      logger?.debug("agent.turn.messageAppended", { seq: run.seq, appended: 1 });
      if (result.usage) usage = addUsage(usage, result.usage);
      // 压缩阈值信号回写：最近一次输入 token = 当前完整上下文占用（含 system/tools）；
      // signalChars 记录此刻字符总量，压缩后按比例重估（context-compact PRD）
      if (result.usage) {
        run.lastInputTokens = result.usage.inputTokens;
        run.signalChars = countRunChars(this.context.runs);
        run.model = runConfig.sampling.model;
        run.maxOutputTokens = runConfig.sampling.maxTokens;
      }
      logger?.debug("agent.call.result", {
        finishReason: result.finishReason,
        curTurn: runProgress.curTurn,
        elapsedMs,
        assembleMs,
        providerMs,
        usage: result.usage,
      });

      // tool_call → 执行工具，结果追加后继续下一轮（turn）
      if (result.finishReason === "tool_call" && result.message.toolCalls) {
        // 审批门控（按 turn 批量）：本轮全部待审调用合并一次征询，决策作用于整批，
        // 且先于任何工具执行——拒绝/未装配时以文本结果进 turn（agent 可见，可自我调整）
        const gate = await this.gateBatch(result.message.toolCalls, run.seq);
        for (const tc of result.message.toolCalls) {
          this.emit(onEvent, "tool-call-request", {
            persist: true,
            seq: run.seq,
            toolCallId: tc.id,
            name: tc.name,
            args: tc.args,
          });
          logger?.debug("agent.tool.dispatch", { tool: tc.name });
          const toolStartedAt = Date.now();
          let text: string;
          try {
            text = gate.get(tc.id) ?? (await this.config.toolDispatcher.dispatch(this.context, tc));
            this.emit(onEvent, "tool-call-response", {
              persist: true,
              seq: run.seq,
              toolCallId: tc.id,
              result: text,
            });
          } catch (err) {
            // 统一错误回填：run 不因工具错误 reject——错误文本进 tool 消息供模型自纠
            // （tool 消息必须照常 append，否则下一轮 provider call 缺 tool result 400）
            const code = err instanceof ToolError ? err.code : "TOOL_HANDLER_FAILED";
            const message = err instanceof Error ? err.message : String(err);
            logger?.error("agent.tool.error", { tool: tc.name, code });
            text = `工具执行失败(${code}): ${message}`;
            this.emit(onEvent, "tool-call-response", {
              persist: true,
              seq: run.seq,
              toolCallId: tc.id,
              error: message,
            });
          }
          logger?.debug("agent.tool.result", { tool: tc.name, elapsedMs: Date.now() - toolStartedAt });
          this.context.appendMessagesTo(run, [{ role: "tool", content: text, id: tc.id }]);
          runProgress.toolsLastTurn.set(tc.name, runProgress.curTurn);
        }
        continue;
      }

      // final（assistant 无 tool_call）或 length：完整 assistant 消息落盘事件 + run 收口
      this.emit(onEvent, "assistant.message", {
        persist: true,
        seq: run.seq,
        text: result.message.content,
      });
      this.emit(onEvent, "run-end", { persist: true, seq: run.seq, runSeq: run.seq });
      logger?.info("agent.loop.run.done", {
        finishReason: result.finishReason,
        usage,
        elapsedMs: Date.now() - runStartedAt,
        turns: runProgress.curTurn + 1,
      });
      return { final: result.message, usage };
    }
    throw new Error(`达到最大轮次 ${runProgress.maxTurn}`);
  }

  /**
   * provider 调用 + 超窗保险丝：组装请求（含压缩）→ 调用；context-length 类错误时
   * 强制压缩（跳过阈值门）并重新组装请求重试一次，仍失败则原样抛出
   * （docs/PRD/context-compact.md 保险丝）
   * @param run 当前 run（压缩事件 seq / 日志用）
   * @param runConfig 单次运行配置（重组装用）
   * @param runProgress 当前进度（重组装用）
   * @param onEvent 输出事件回调（delta 缓冲 / compacted 事件）
   * @returns 结果与耗时拆解
   */
  private async callProviderWithFuse(
    run: RunContext,
    runConfig: AgentRunConfig,
    runProgress: RunProgress,
    onEvent: ((e: LoopEvent) => void) | undefined,
  ): Promise<{
    result: ProviderResult;
    assembleMs: number;
    providerMs: number;
    elapsedMs: number;
  }> {
    const logger = this.config.logger;
    const assembleStartedAt = Date.now();
    let call = await this.context.toProviderCall(runConfig, runProgress, this.controller.signal);
    this.flushCompacted(onEvent, run);
    const assembleMs = Date.now() - assembleStartedAt;
    const providerStartedAt = Date.now();
    for (let attempt = 0; ; attempt++) {
      this.config.debugger?.record(call); // 记录每次请求（相邻差异在 html 展示）
      // 每 turn 重置思考计数（新一轮 reasoning 从 0 起报；保险丝重试同）。
      this.resetReasoningHeartbeat();
      try {
        const result = await this.config.provider.call(call, (d) => {
          if (d.type === "reasoning-delta") {
            // 思考内容不上链（gui-performance 一期决策保留）：只累计字符数，
            // 1s 节流发无内容心跳（UI「深度思考中 · 约 N 字」活性指示）。
            this.reasoningChars += d.text.length;
            this.bufferReasoningHeartbeat(onEvent);
            return;
          }
          if (d.type !== "text-delta") return;
          // 正文开始 = 思考结束：取消未触发的心跳（防止过期 thinking 态回跳），再进合并缓冲
          // （32ms 尾窗冲刷；任何其他事件发射前强制冲刷保序）：
          // 每 SSE chunk 一条 RPC → ≤~30Hz 合并事件，见 docs/PRD/gui-performance-2.md 功能点一。
          this.cancelReasoningHeartbeat();
          this.bufferDelta(onEvent, d.text);
        });
        return {
          result,
          assembleMs,
          providerMs: Date.now() - providerStartedAt,
          elapsedMs: Date.now() - assembleStartedAt,
        };
      } catch (err) {
        if (attempt === 0 && isContextLengthError(err)) {
          logger?.warn("agent.call.context_length_fuse", {
            seq: run.seq,
            curTurn: runProgress.curTurn,
          });
          const compacted = await this.context.forceCompact();
          this.flushCompacted(onEvent, run);
          if (compacted) {
            // 重组装（压缩已改写消息序列）后重试一次；二次超窗不再重试。
            // 重组装本身也可能再触发常规压缩（阈值已降），随后立即冲刷事件防归属错位
            call = await this.context.toProviderCall(runConfig, runProgress, this.controller.signal);
            this.flushCompacted(onEvent, run);
            continue;
          }
        }
        logger?.error("agent.call.error", {
          curTurn: runProgress.curTurn,
          error: err instanceof Error ? err.constructor.name : String(err),
        });
        throw err;
      }
    }
  }

  /** 压缩通知冲刷：onCompacted 置位后发射 compacted 边界事件（幂等，无 pending 时 no-op） */
  private flushCompacted(onEvent: ((e: LoopEvent) => void) | undefined, run: RunContext): void {
    if (!this.pendingCompacted) return;
    this.pendingCompacted = false;
    this.emit(onEvent, "compacted", { persist: true, seq: run.seq });
  }

  /**
   * 审批门控（按 turn 批量）：本轮返回中 requireApproval 的调用合并为一次征询，
   * 决策作用于整批（approve 全放行 / reject 全拒绝 / edit 全拒绝附意见），
   * 且先于任何工具执行发起。compose 权限先行：激活期 canonical 写硬拒绝（无审批通道）、
   * bypass 模式 canonical 写跳过审批直接放行（ExitComposeMode 不在名单，恒走审批门）。
   * @param toolCalls 本轮全部工具调用（含免审项）
   * @param runSeq 当前 run 序号（requestId 归组用）
   * @returns toolCallId → 拒绝结果文本（放行项不在 map 中）
   */
  private async gateBatch(toolCalls: readonly ToolCall[], runSeq: number): Promise<Map<string, string>> {
    const compose = this.config.composeState?.snapshot(this.config.conversationId ?? "");
    const denied = new Map<string, string>();
    const pending: ToolCall[] = [];
    const willDispatch: ToolCall[] = [];
    for (const tc of toolCalls) {
      // compose 激活：canonical 写硬拒绝（无审批通道），Read/文件工具不受影响
      if (compose?.active === true && isCanonicalNovelWrite(tc.name)) {
        denied.set(
          tc.id,
          `已拒绝（设计模式激活：正式稿只读，请将草稿写入 design 文件，不要调用 ${tc.name}）`,
        );
        continue;
      }
      // 按调用审批（PRD memory-两层记忆 M1）：requireApproval 静态命中，或
      // requiresApprovalFor 判定本次调用命中守卫目标（Write/Edit → NOVEL.md）
      const def = this.config.toolDispatcher.resolve(tc.name);
      const requireApproval =
        def?.requireApproval === true || def?.requiresApprovalFor?.(tc) === true;
      // bypass 模式：canonical 写跳过审批直接放行
      const bypass = compose?.mode === "bypass" && isCanonicalNovelWrite(tc.name);
      if (requireApproval && !bypass) pending.push(tc);
      willDispatch.push(tc);
    }
    // 审批前预检（PRD novel-tools-legacy-对齐 §4-5）：将执行的调用逐个跑只读 precheck，
    // 失败项直接以错误文本收口——不进审批批、不执行（避免无效审批）
    const precheckDenied = new Map<string, string>();
    for (const tc of willDispatch) {
      const precheck = this.config.toolDispatcher.resolve(tc.name)?.precheck;
      if (precheck === undefined) continue;
      try {
        await precheck(tc);
      } catch (err) {
        const code = err instanceof ToolError ? err.code : "TOOL_PRECHECK_FAILED";
        const message = err instanceof Error ? err.message : String(err);
        precheckDenied.set(tc.id, `预检未通过(${code}): ${message}`);
      }
    }
    for (const [id, text] of precheckDenied) denied.set(id, text);
    const approved = pending.filter((tc) => !precheckDenied.has(tc.id));
    if (approved.length === 0) return denied;
    if (this.config.requestApproval === undefined) {
      for (const tc of approved) denied.set(tc.id, "已拒绝（审批通道未装配）");
      return denied;
    }
    const decision = await this.config.requestApproval({
      requestId: `approval:${this.config.conversationId ?? "conv"}:${runSeq}:b${++this.batchSeq}`,
      toolCalls: approved.map((tc) => ({ toolCallId: tc.id, toolName: tc.name, args: tc.args })),
    });
    if (decision.kind === "approve") return denied;
    for (const tc of approved) {
      if (tc.name === "ExitComposeMode") {
        // 退出 compose 的驳回：意见随决策回传（PRD F5/D9）
        denied.set(tc.id, decision.kind === "reject" ? "用户驳回了" : `用户驳回了：${decision.text}`);
        continue;
      }
      denied.set(
        tc.id,
        decision.kind === "reject" ? "已拒绝" : `已拒绝（用户意见：${decision.text}）`,
      );
    }
    return denied;
  }

  /**
   * 开新 run（输入时序即时分配 seq）：appendRun 进上下文。
   * 不发事件——run-start / user.message 由 emitRunOpen 在实际执行时发射，
   * 排队 run 的边界事件不插进正在流式的前一个 run（上层持久化回执经
   * journal.appendRun 直调 run 对象，不依赖事件时机）。
   * @param text 用户消息文本
   * @returns 新开 run（seq 已分配）
   */
  private createRun(text: string): RunContext {
    const messages: LLMessage[] = [{ role: "user", content: text }];
    const run: RunContext = {
      seq: 0, // 由 LoopContext 覆盖分配
      messages,
      ts: new Date().toISOString(),
      appendRunMessages: (m) => {
        messages.push(...m);
      },
    };
    this.context.appendRun(run);
    this.config.logger?.debug("agent.run.appended", { seq: run.seq });
    return run;
  }

  /** 发射 run 开场边界（run-start + user.message；drain 实际执行该 run 时调用） */
  private emitRunOpen(run: RunContext, text: string, onEvent?: (e: LoopEvent) => void): void {
    this.emit(onEvent, "run-start", { persist: true, seq: run.seq, runSeq: run.seq });
    this.emit(onEvent, "user.message", { persist: true, seq: run.seq, text });
  }

  /** 缓冲思考心跳（1s 尾窗；窗口内幂等排程，只发累计计数不发内容） */
  private bufferReasoningHeartbeat(onEvent: ((e: LoopEvent) => void) | undefined): void {
    if (this.reasoningHeartbeatTimer !== undefined) return;
    this.reasoningHeartbeatTimer = setTimeout(() => {
      this.reasoningHeartbeatTimer = undefined;
      if (this.reasoningChars <= 0) return;
      this.emit(onEvent, "assistant.delta", {
        kind: "reasoning",
        text: "",
        chars: this.reasoningChars,
      });
    }, REASONING_HEARTBEAT_MS);
  }

  /** 取消未触发的思考心跳（正文开始 / 非 delta 事件发射时：防过期 thinking 态回跳） */
  private cancelReasoningHeartbeat(): void {
    if (this.reasoningHeartbeatTimer === undefined) return;
    clearTimeout(this.reasoningHeartbeatTimer);
    this.reasoningHeartbeatTimer = undefined;
  }

  /** 每 turn 重置思考计数（新一轮 reasoning 从 0 起报） */
  private resetReasoningHeartbeat(): void {
    this.cancelReasoningHeartbeat();
    this.reasoningChars = 0;
  }

  /** 缓冲 text-delta（32ms 尾窗合并成一条事件；窗口内幂等排程） */
  private bufferDelta(onEvent: ((e: LoopEvent) => void) | undefined, text: string): void {
    this.pendingDeltaText += text;
    this.pendingDeltaOnEvent = onEvent;
    if (this.deltaFlushTimer === undefined) {
      this.deltaFlushTimer = setTimeout(() => {
        this.deltaFlushTimer = undefined;
        this.flushPendingDelta();
      }, DELTA_COALESCE_MS);
    }
  }

  /** 冲刷 delta 缓冲（空缓冲 no-op；emit 非 delta 类型前必经，保证流文本先于后续事件） */
  private flushPendingDelta(): void {
    if (this.deltaFlushTimer !== undefined) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = undefined;
    }
    if (this.pendingDeltaText === "") return;
    const text = this.pendingDeltaText;
    const onEvent = this.pendingDeltaOnEvent;
    this.pendingDeltaText = "";
    this.pendingDeltaOnEvent = undefined;
    this.emit(onEvent, "assistant.delta", { kind: "text", text });
  }

  /** 发出 LoopEvent（补 seq/conversationId/agentId/ts；通知 onEvent + 持久订阅者） */
  private emit(
    onEvent: ((e: LoopEvent) => void) | undefined,
    type: LoopEvent["type"],
    extra: Record<string, unknown>,
  ): void {
    // 保序不变量：非 delta 事件发射前先冲刷缓冲中的流文本（本 turn 全部文本
    // 先于 assistant.message / 工具事件到达消费端）；同时取消待发思考心跳
    // （turn 已收口，迟发会把 UI 拽回 thinking 态）
    if (type !== "assistant.delta") {
      this.flushPendingDelta();
      this.cancelReasoningHeartbeat();
    }
    const event = {
      type,
      seq: 0,
      conversationId: this.config.conversationId,
      agentId: this.config.agentId,
      ts: new Date().toISOString(),
      ...extra,
    } as LoopEvent;
    onEvent?.(event);
    // 逐订阅者保护：单个订阅者（hub 转发/持久化 listener）异常不阻断其余订阅者与 run
    for (const l of this.outputListeners) {
      try {
        l(event);
      } catch (error) {
        this.config.logger?.warn("loop.output_listener_failed", {
          type: event.type,
          error: String(error),
        });
      }
    }
  }
}
