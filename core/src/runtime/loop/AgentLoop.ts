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

/** AgentLoop：agent 主循环，产出 OutputEvent（conversation 统一事件） */
export class AgentLoop {
  /** 构造配置 */
  private readonly config: AgentLoopConfig;
  /** 会话上下文（构造时初始化，由 AgentCapability 组装） */
  private readonly context: LoopContext;
  /** 取消控制器（cancel 触发） */
  private readonly controller = new AbortController();

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
    });
    for (const listener of config.listeners ?? []) {
      this.context.subscribe(listener);
    }
  }

  /**
   * 处理一次用户输入：appendTurnContext 开 turn → 循环 toProviderCall / provider.call，
   * 结果与 tool 结果追加当前 turn，直至 assistant 无 tool_call（final）/ length / maxTurns。
   * 产出 OutputEvent 流（assistant.delta / tool-call-request / tool-call-response / turn-start / turn-end）。
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
    const logger = this.config.logger;
    logger?.info("agent.loop.run.start", { inputLen: input.length });

    // ① 由 runConfig 初始化运行状态
    const runContext: RunContext = {
      curTurn: 0,
      maxTurn: runConfig.maxTurns ?? DEFAULT_MAX_TURNS,
      toolsLastTurn: new Map(),
    };

    // ② 开新 turn（input 组装）
    const messages: LLMessage[] = [{ role: "user", content: input }];
    const turn: TurnContext = {
      seq: 0, // 由 LoopContext 覆盖分配
      messages,
      ts: new Date().toISOString(),
      appendTurnMessages: (m) => {
        messages.push(...m);
      },
    };
    this.context.appendTurnContext(turn);
    this.emit(onEvent, "turn-start", { persist: true, turnSeq: turn.seq });
    logger?.debug("agent.turn.appended", { seq: turn.seq });

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
            toolCallId: tc.id,
            name: tc.name,
            args: tc.args,
          });
          logger?.debug("agent.tool.dispatch", { tool: tc.name });
          const text = await this.config.toolDispatcher.dispatch(this.context, tc);
          this.emit(onEvent, "tool-call-response", {
            persist: true,
            toolCallId: tc.id,
            result: text,
          });
          logger?.debug("agent.tool.result", { tool: tc.name });
          this.context.appendTurnMessages([{ role: "tool", content: text, id: tc.id }]);
          runContext.toolsLastTurn.set(tc.name, runContext.curTurn);
        }
        continue;
      }

      // final（assistant 无 tool_call）或 length
      this.emit(onEvent, "turn-end", { persist: true, turnSeq: turn.seq });
      logger?.info("agent.loop.run.done", { finishReason: result.finishReason, usage });
      return { final: result.message, usage };
    }
    throw new Error(`达到最大轮次 ${runContext.maxTurn}`);
  }

  /**
   * 取消当前 run
   */
  cancel(): void {
    this.controller.abort();
  }

  /** 发出 OutputEvent（补 seq/conversationId/agentId/ts；持久化 seq 由 journal append 时分配） */
  private emit(
    onEvent: ((e: OutputEvent) => void) | undefined,
    type: OutputEvent["type"],
    extra: Record<string, unknown>,
  ): void {
    if (!onEvent) return;
    onEvent({
      type,
      seq: 0,
      conversationId: this.config.conversationId,
      agentId: this.config.agentId,
      ts: new Date().toISOString(),
      ...extra,
    } as OutputEvent);
  }
}
