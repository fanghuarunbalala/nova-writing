import type {
  LLMessage,
  ProviderResult,
  ProviderDelta,
} from "../provider/types.js";
import type {
  AgentLoopConfig,
  AgentLoopResult,
  AgentRunConfig,
  RunContext,
  TurnContext,
  LoopInput,
} from "./types.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";
import { LoopContext } from "./LoopContext.js";

/** 缺省最大轮次（防死循环） */
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

/** ProviderDelta → assistant.delta 事件 extra 字段 */
function toDeltaExtra(d: ProviderDelta): Record<string, unknown> {
  return d.type === "text-delta"
    ? { persist: false, kind: "text", text: d.text }
    : { persist: false, kind: "reasoning", text: d.text };
}

/** AgentLoop：agent 主循环，产出 OutputEvent（conversation 统一事件），带输入队列 */
export class AgentLoop {
  /** 构造配置 */
  private readonly config: AgentLoopConfig;
  /** 会话上下文（构造时初始化，由 AgentCapability 组装） */
  private readonly context: LoopContext;
  /** 取消控制器（cancel 触发） */
  private readonly controller = new AbortController();
  /** 输入队列（turn 排队 / control 抢占） */
  private inbox: LoopInput[] = [];
  /** 是否正在 drain / run */
  private running = false;
  /** 入队 run 的结果 resolve（resolveId → resolve/reject） */
  private readonly pendingRuns = new Map<string, { resolve: (r: AgentLoopResult) => void; reject: (e: unknown) => void }>();
  /** 输入序号递增 */
  private inputSeq = 0;
  /** 最近一次 run 的 config（followup 无 config 时复用） */
  private lastConfig?: AgentRunConfig;
  /** 输出事件订阅者（持久：run/followup 产出的所有 OutputEvent） */
  private readonly outputListeners = new Set<(e: OutputEvent) => void>();

  /**
   * 构造 AgentLoop
   * @param config 构造配置（workspace + Provider + 能力 + 工具调度 + 恢复消息 + 监听器 + 日志）
   */
  constructor(config: AgentLoopConfig) {
    this.config = config;
    this.context = new LoopContext({
      agentCapability: config.agentCapability,
      workspace: config.workspace,
      turnMessages: config.turnMessages,
      startSeq: config.startSeq,
    });
    for (const listener of config.listeners ?? []) {
      this.context.subscribe(listener);
    }
  }

  /**
   * 处理一次用户输入：若 idle 立即执行；若 running 入队（串行，当前 run 结束后处理）。
   * @param input 用户消息文本
   * @param runConfig 单次运行配置
   * @param onEvent 输出事件回调（OutputEvent 流）
   * @returns 运行结果
   */
  async run(
    input: string,
    runConfig: AgentRunConfig,
    onEvent?: (e: OutputEvent) => void,
  ): Promise<AgentLoopResult> {
    this.lastConfig = runConfig;
    const turn = this.startTurn(input, onEvent);
    if (this.running) {
      // 入队，等当前 run 完成（turn 已开，执行时复用）
      return new Promise<AgentLoopResult>((resolve, reject) => {
        const resolveId = `run_${++this.inputSeq}`;
        this.pendingRuns.set(resolveId, { resolve, reject });
        this.inbox.push({ lane: "turn", kind: "followup", text: input, turn, config: runConfig, onEvent, resolveId });
      });
    }
    return this.runInternal(input, runConfig, onEvent, turn);
  }

  /**
   * 追加用户消息（turn lane，排队；若 idle 立即 drain）。
   * turn 在入队时即时创建（seq 按输入时序分配），执行时复用——上层可同步落盘拿到持久化回执。
   * @param text 用户消息文本
   * @param runConfig 单次运行配置（缺省复用上次 run 的 config）
   * @returns 新开 turn（seq 已分配；turn-start / user.message 已发出）
   */
  followup(text: string, runConfig?: AgentRunConfig): TurnContext {
    const turn = this.startTurn(text, undefined);
    this.inbox.push({ lane: "turn", kind: "followup", text, turn, config: runConfig });
    if (!this.running) void this.drain();
    return turn;
  }

  /** 转向指令（control lane，高优先级，注入 system reminder） */
  steer(text: string): void {
    this.inbox.push({ lane: "control", kind: "steer", text });
    if (!this.running) void this.drain();
  }

  /** 停止：取消当前 + 清空 turn 队列 */
  stop(): void {
    this.controller.abort();
    this.inbox = this.inbox.filter((i) => !(i.lane === "turn" && i.kind === "followup"));
  }

  /** 订阅输出事件（run/followup 产出的所有 OutputEvent），返回取消订阅 */
  onOutputEvent(l: (e: OutputEvent) => void): () => void {
    this.outputListeners.add(l);
    return () => this.outputListeners.delete(l);
  }

  /**
   * 取消当前 run
   */
  cancel(): void {
    this.controller.abort();
  }

  /** 串行 drain：消费输入队列（control 优先于 turn，同 lane FIFO） */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.inbox.length > 0) {
        const input = this.takeNext();
        if (input.kind === "stop") continue;
        if (input.kind === "steer") {
          // 注入 system reminder（转向）
          this.context.appendTurnMessages([{ role: "system", content: input.text }]);
          continue;
        }
        // followup（turn 已在入队时预开，执行时复用）
        const config = input.config ?? this.lastConfig;
        if (!config) continue;
        if (input.resolveId) {
          try {
            const result = await this.runInternal(input.text, config, input.onEvent, input.turn);
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
          await this.runInternal(input.text, config, undefined, input.turn);
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
   * 实际执行一轮：循环 toProviderCall / provider.call，
   * 直至 assistant 无 tool_call（final）/ length / maxTurns。
   * @param input 用户消息文本
   * @param runConfig 单次运行配置
   * @param onEvent 输出事件回调
   * @param turn 入队时预开的 turn（turn-start / user.message 已发出）
   */
  private async runInternal(
    input: string,
    runConfig: AgentRunConfig,
    onEvent: ((e: OutputEvent) => void) | undefined,
    turn: TurnContext,
  ): Promise<AgentLoopResult> {
    const logger = this.config.logger;
    logger?.info("agent.loop.run.start", { inputLen: input.length });

    // ① 由 runConfig 初始化运行状态
    const runContext: RunContext = {
      curTurn: 0,
      maxTurn: runConfig.maxTurns ?? DEFAULT_MAX_TURNS,
      toolsLastTurn: new Map(),
    };

    // ③ 循环
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for (runContext.curTurn = 0; runContext.curTurn < runContext.maxTurn; runContext.curTurn++) {
      logger?.debug("agent.call.request", {
        model: runConfig.sampling.model,
        curTurn: runContext.curTurn,
      });
      const call = this.context.toProviderCall(runConfig, runContext, this.controller.signal);
      this.config.debugger?.record(call); // 记录每次请求（相邻差异在 html 展示）
      let result: ProviderResult;
      try {
        result = await this.config.provider.call(call, (d) =>
          this.emit(onEvent, "assistant.delta", toDeltaExtra(d)),
        );
      } catch (err) {
        logger?.error("agent.call.error", {
          curTurn: runContext.curTurn,
          error: err instanceof Error ? err.constructor.name : String(err),
        });
        throw err;
      }
      this.context.appendTurnMessages([result.message]);
      logger?.debug("agent.turn.messageAppended", { seq: turn.seq, appended: 1 });
      if (result.usage) usage = addUsage(usage, result.usage);
      logger?.debug("agent.call.result", {
        finishReason: result.finishReason,
        curTurn: runContext.curTurn,
      });

      // tool_call → 执行工具，结果追加后继续下一轮
      if (result.finishReason === "tool_call" && result.message.toolCalls) {
        for (const tc of result.message.toolCalls) {
          this.emit(onEvent, "tool-call-request", {
            persist: true,
            seq: turn.seq,
            toolCallId: tc.id,
            name: tc.name,
            args: tc.args,
          });
          logger?.debug("agent.tool.dispatch", { tool: tc.name });
          const text = await this.config.toolDispatcher.dispatch(this.context, tc);
          this.emit(onEvent, "tool-call-response", {
            persist: true,
            seq: turn.seq,
            toolCallId: tc.id,
            result: text,
          });
          logger?.debug("agent.tool.result", { tool: tc.name });
          this.context.appendTurnMessages([{ role: "tool", content: text, id: tc.id }]);
          runContext.toolsLastTurn.set(tc.name, runContext.curTurn);
        }
        continue;
      }

      // final（assistant 无 tool_call）或 length：完整 assistant 消息落盘事件 + turn 收口
      this.emit(onEvent, "assistant.message", {
        persist: true,
        seq: turn.seq,
        text: result.message.content,
      });
      this.emit(onEvent, "turn-end", { persist: true, seq: turn.seq, turnSeq: turn.seq });
      logger?.info("agent.loop.run.done", { finishReason: result.finishReason, usage });
      return { final: result.message, usage };
    }
    throw new Error(`达到最大轮次 ${runContext.maxTurn}`);
  }

  /**
   * 开新 turn（输入时序即时分配 seq）：appendTurnContext + 发 turn-start / user.message。
   * @param text 用户消息文本
   * @param onEvent 事件回调（run() 路径传其 onEvent；followup() 路径仅 hub 订阅者）
   * @returns 新 turn（seq 已分配）
   */
  private startTurn(text: string, onEvent?: (e: OutputEvent) => void): TurnContext {
    const messages: LLMessage[] = [{ role: "user", content: text }];
    const turn: TurnContext = {
      seq: 0, // 由 LoopContext 覆盖分配
      messages,
      ts: new Date().toISOString(),
      appendTurnMessages: (m) => {
        messages.push(...m);
      },
    };
    this.context.appendTurnContext(turn);
    this.emit(onEvent, "turn-start", { persist: true, seq: turn.seq, turnSeq: turn.seq });
    this.emit(onEvent, "user.message", { persist: true, seq: turn.seq, text });
    this.config.logger?.debug("agent.turn.appended", { seq: turn.seq });
    return turn;
  }

  /** 发出 OutputEvent（补 seq/conversationId/agentId/ts；通知 onEvent + 持久订阅者） */
  private emit(
    onEvent: ((e: OutputEvent) => void) | undefined,
    type: OutputEvent["type"],
    extra: Record<string, unknown>,
  ): void {
    const event = {
      type,
      seq: 0,
      conversationId: this.config.conversationId,
      agentId: this.config.agentId,
      ts: new Date().toISOString(),
      ...extra,
    } as OutputEvent;
    onEvent?.(event);
    for (const l of this.outputListeners) l(event);
  }
}
