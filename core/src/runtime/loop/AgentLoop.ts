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
import { ToolError } from "../tool/errors.js";
import { LoopContext } from "./LoopContext.js";

/** 缺省最大轮次（每 run 最大 turn 数，防死循环） */
const DEFAULT_MAX_TURNS = 100;

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
      startSeq: config.startSeq,
      platform: config.platform,
      novelConstraintsProvider: config.novelConstraintsProvider,
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
    logger?.info("agent.loop.run.start", { inputLen: input.length });
    this.emitRunOpen(run, input, onEvent);

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
      if (decision === "approve") {
        text = await this.config.toolDispatcher.dispatch(this.context, toolCall);
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
      this.context.appendRunMessages([{ role: "tool", content: text, id: toolCallId }]);
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
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for (runProgress.curTurn = 0; runProgress.curTurn < runProgress.maxTurn; runProgress.curTurn++) {
      logger?.debug("agent.call.request", {
        model: runConfig.sampling.model,
        curTurn: runProgress.curTurn,
      });
      const call = await this.context.toProviderCall(runConfig, runProgress, this.controller.signal);
      this.config.debugger?.record(call); // 记录每次请求（相邻差异在 html 展示）
      let result: ProviderResult;
      try {
        result = await this.config.provider.call(call, (d) => {
          // reasoning delta 在 loop 层直接丢弃（思考内容不上链、UI 不展示思考中态）：
          // 不 emit 任何事件，省去 hub/WS/IPC 全链传输成本。见 docs/PRD/gui-performance.md。
          if (d.type !== "text-delta") return;
          this.emit(onEvent, "assistant.delta", { kind: "text", text: d.text });
        });
      } catch (err) {
        logger?.error("agent.call.error", {
          curTurn: runProgress.curTurn,
          error: err instanceof Error ? err.constructor.name : String(err),
        });
        throw err;
      }
      this.context.appendRunMessages([result.message]);
      logger?.debug("agent.turn.messageAppended", { seq: run.seq, appended: 1 });
      if (result.usage) usage = addUsage(usage, result.usage);
      logger?.debug("agent.call.result", {
        finishReason: result.finishReason,
        curTurn: runProgress.curTurn,
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
          logger?.debug("agent.tool.result", { tool: tc.name });
          this.context.appendRunMessages([{ role: "tool", content: text, id: tc.id }]);
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
      logger?.info("agent.loop.run.done", { finishReason: result.finishReason, usage });
      return { final: result.message, usage };
    }
    throw new Error(`达到最大轮次 ${runProgress.maxTurn}`);
  }

  /**
   * 审批门控（按 turn 批量）：本轮返回中 requireApproval 的调用合并为一次征询，
   * 决策作用于整批（approve 全放行 / reject 全拒绝 / edit 全拒绝附意见），
   * 且先于任何工具执行发起。
   * @param toolCalls 本轮全部工具调用（含免审项）
   * @param runSeq 当前 run 序号（requestId 归组用）
   * @returns toolCallId → 拒绝结果文本（放行项不在 map 中）
   */
  private async gateBatch(toolCalls: readonly ToolCall[], runSeq: number): Promise<Map<string, string>> {
    const pending = toolCalls.filter(
      (tc) => this.config.toolDispatcher.resolve(tc.name)?.requireApproval === true,
    );
    if (pending.length === 0) return new Map();
    if (this.config.requestApproval === undefined) {
      return new Map(pending.map((tc) => [tc.id, "已拒绝（审批通道未装配）"] as const));
    }
    const decision = await this.config.requestApproval({
      requestId: `approval:${this.config.conversationId ?? "conv"}:${runSeq}:b${++this.batchSeq}`,
      toolCalls: pending.map((tc) => ({ toolCallId: tc.id, toolName: tc.name, args: tc.args })),
    });
    if (decision.kind === "approve") return new Map();
    const text = decision.kind === "reject" ? "已拒绝" : `已拒绝（用户意见：${decision.text}）`;
    return new Map(pending.map((tc) => [tc.id, text] as const));
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

  /** 发出 LoopEvent（补 seq/conversationId/agentId/ts；通知 onEvent + 持久订阅者） */
  private emit(
    onEvent: ((e: LoopEvent) => void) | undefined,
    type: LoopEvent["type"],
    extra: Record<string, unknown>,
  ): void {
    const event = {
      type,
      seq: 0,
      conversationId: this.config.conversationId,
      agentId: this.config.agentId,
      ts: new Date().toISOString(),
      ...extra,
    } as LoopEvent;
    onEvent?.(event);
    for (const l of this.outputListeners) l(event);
  }
}
