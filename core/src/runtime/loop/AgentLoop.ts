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
  TurnContext,
  LoopInput,
} from "./types.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";
import { isCanonicalNovelWrite } from "../../conversation/compose/canonicalTools.js";
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
      platform: config.platform,
      novelConstraintsProvider: config.novelConstraintsProvider,
      beforeProviderCall: config.beforeProviderCall,
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
          try {
            await this.runInternal(input.text, config, undefined, input.turn);
          } catch (e) {
            const turn = input.turn;
            if (this.controller.signal.aborted) {
              // 用户 stop/cancel：abort 是正常路径，静默收口（不发错误文案）
              this.config.logger?.debug("agent.loop.run.aborted", { seq: turn.seq });
              this.emit(undefined, "turn-end", { persist: true, seq: turn.seq, turnSeq: turn.seq });
              continue;
            }
            // turn 管线异常（provider / 工具 / 监听器）：收口为可见错误，进程继续服务后续消息
            this.config.logger?.error("agent.loop.run.error", {
              seq: turn.seq,
              error: e instanceof Error ? e.constructor.name : String(e),
            });
            const text = `（生成失败：${e instanceof Error ? e.message : String(e)}）`;
            this.emit(undefined, "assistant.message", { persist: true, seq: turn.seq, text });
            this.emit(undefined, "turn-end", { persist: true, seq: turn.seq, turnSeq: turn.seq });
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

    return this.runTurnLoop(turn, runConfig, onEvent, runContext);
  }

  /**
   * 暂停点续跑：恢复 turn 中缺 tool 结果的 toolCall 按决策补完（approve 执行 handler /
   * reject「已拒绝」/ expired「审批超时，按拒绝处理」/ 未装配「已拒绝」），
   * 随后继续 provider 循环到 turn 收口（事件与 journal 同 seq 重写经 listener 走）。
   * @param runConfig 采样配置
   * @returns 运行结果（最终 assistant 消息）
   */
  async resumePendingTurn(runConfig: AgentRunConfig): Promise<AgentLoopResult> {
    const turn = this.context.turns.at(-1);
    if (turn === undefined) throw new Error("无可恢复的 turn（journal 为空）");
    // 补完缺 tool 结果的 toolCall（恢复快照里 assistant.toolCalls 无对应 tool 消息的）
    const assistantMessages = turn.messages.filter(
      (m) => m.role === "assistant" && m.toolCalls !== undefined && m.toolCalls.length > 0,
    ) as AssistantMessage[];
    const pendingToolIds = assistantMessages
      .flatMap((m) => m.toolCalls!.map((tc) => tc.id))
      .filter((id) => !turn.messages.some((m) => m.role === "tool" && m.id === id));
    for (const toolCallId of pendingToolIds) {
      const toolCall = assistantMessages
        .flatMap((m) => m.toolCalls!)
        .find((tc) => tc.id === toolCallId)!;
      if (toolCall === undefined) continue;
      const decision = await this.config.resumePendingDecider?.(toolCallId);
      let text: string;
      if (decision === "approve") {
        // 重启补完同样执行 compose 权限检查（approve 分支绕过 gateTool）
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
        seq: turn.seq,
        toolCallId,
        result: text,
      });
      this.context.appendTurnMessages([{ role: "tool", content: text, id: toolCallId }]);
    }
    const runContext: RunContext = {
      curTurn: 0,
      maxTurn: runConfig.maxTurns ?? DEFAULT_MAX_TURNS,
      toolsLastTurn: new Map(),
    };
    return this.runTurnLoop(turn, runConfig, undefined, runContext);
  }

  /** 单 turn 的 provider 循环：toProviderCall → call → tool 执行/收口，直到 final 或 maxTurns */
  private async runTurnLoop(
    turn: TurnContext,
    runConfig: AgentRunConfig,
    onEvent: ((e: OutputEvent) => void) | undefined,
    runContext: RunContext,
  ): Promise<AgentLoopResult> {
    const logger = this.config.logger;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for (runContext.curTurn = 0; runContext.curTurn < runContext.maxTurn; runContext.curTurn++) {
      logger?.debug("agent.call.request", {
        model: runConfig.sampling.model,
        curTurn: runContext.curTurn,
      });
      const call = await this.context.toProviderCall(runConfig, runContext, this.controller.signal);
      this.config.debugger?.record(call); // 记录每次请求（相邻差异在 html 展示）
      let result: ProviderResult;
      try {
        result = await this.config.provider.call(call, (d) => {
          // reasoning delta 在 loop 层直接丢弃（思考内容不上链、UI 不展示思考中态）：
          // 不 emit 任何事件，省去 hub/WS/IPC 全链传输成本。见 docs/PRD/gui-performance.md。
          if (d.type !== "text-delta") return;
          this.emit(onEvent, "assistant.delta", { persist: false, kind: "text", text: d.text });
        });
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
          // 审批门控：拒绝/未装配时以文本结果进 turn（agent 可见，可自我调整）
          const gate = await this.gateTool(tc, turn.seq);
          const text =
            gate ?? (await this.config.toolDispatcher.dispatch(this.context, tc));
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
   * 审批门控：compose 权限（激活 deny canonical 写 / bypass 放行）→ requireApproval
   * 工具执行前经 requestApproval 征询。
   * @param tc 工具调用
   * @param turnSeq 当前 turn 序号（requestId 归组用）
   * @returns undefined = 放行执行；字符串 = 拒绝结果文本（作为 tool-call-response 进 turn 继续）
   */
  private async gateTool(tc: ToolCall, turnSeq: number): Promise<string | undefined> {
    const compose = this.config.composeState?.snapshot(this.config.conversationId ?? "");
    // compose 激活：canonical 写硬拒绝（无审批通道），Read/文件工具不受影响
    if (compose?.active === true && isCanonicalNovelWrite(tc.name)) {
      return `已拒绝（设计模式激活：正式稿只读，请将草稿写入 design 文件，不要调用 ${tc.name}）`;
    }
    const toolDef = this.config.toolDispatcher.resolve(tc.name);
    if (toolDef?.requireApproval !== true) return undefined;
    // bypass 模式：canonical 写跳过审批直接放行（ExitComposeMode 不在名单，恒走审批门）
    if (compose?.mode === "bypass" && isCanonicalNovelWrite(tc.name)) return undefined;
    if (this.config.requestApproval === undefined) return "已拒绝（审批通道未装配）";
    const decision = await this.config.requestApproval({
      requestId: `approval_${this.config.conversationId ?? "conv"}_${turnSeq}_${tc.id}`,
      toolName: tc.name,
      args: tc.args,
    });
    if (decision.kind === "approve") return undefined;
    if (tc.name === "ExitComposeMode") {
      // 退出 compose 的驳回：意见随决策回传（PRD F5/D9）
      return decision.kind === "reject" ? "用户驳回了" : `用户驳回了：${decision.text}`;
    }
    if (decision.kind === "reject") return "已拒绝";
    return `已拒绝（用户意见：${decision.text}）`;
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
