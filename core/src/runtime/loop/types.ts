import type { Provider } from "../provider/Provider.js";
import type {
  LLMessage,
  ToolScheme,
  SamplingConfig,
  ToolCall,
  AssistantMessage,
} from "../provider/types.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type { ToolDispatcher } from "../tool/ToolDispatcher.js";
import type { Logger } from "../../log/Logger.js";
import type { ProviderCallDebugger } from "../debug/ProviderCallDebugger.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";
import type {
  ConversationApprovalDecision,
  ConversationApprovalRequest,
} from "../../conversation/contract/types/index.js";

/** AgentLoop 构造配置：进程生命周期稳定（能力由上层组装好传入） */
export interface AgentLoopConfig {
  /** 工作区路径（agent 文件操作环境） */
  workspace: string;
  /** Provider 实例 */
  provider: Provider;
  /** Agent 能力（上层组装：system 分段 + 工具定义 + 策略） */
  agentCapability: AgentCapability;
  /** 工具调度（上层注入，非单例） */
  toolDispatcher: ToolDispatcher;
  /** conversation id（产出 OutputEvent 用） */
  conversationId?: string;
  /** agent id（产出 OutputEvent 用；main="main"） */
  agentId?: string;
  /** 可恢复的 turn 消息（上次会话；缺省从空开始） */
  turnMessages?: LLMessage[];
  /** turn seq 起始值（journal 恢复：重放后的下个 turn 从 resumeSeq+1 开始） */
  startSeq?: number;
  /** 状态变化监听器（AgentLoop 构造时注册到 LoopContext；可多个） */
  listeners?: LoopContextListener[];
  /**
   * 审批通道：requireApproval 工具执行前征询（子进程内闭包，不跨 RPC）。
   * 未注入时 requireApproval 工具按拒绝处理（返回「已拒绝（审批通道未装配）」），
   * 保证无 UI / 测试环境可用。
   */
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>;
  /** 结构化日志（上层 createLogger 注入；缺省不打日志） */
  logger?: Logger;
  /** ProviderCall 调试器（debug 模式注入；记录每次请求 + 相邻差异，jsonl + html） */
  debugger?: ProviderCallDebugger;
}

/** 单次运行配置：run 时传入 */
export interface AgentRunConfig {
  /** 采样配置 */
  sampling: SamplingConfig;
  /** 最大轮次（防死循环） */
  maxTurns?: number;
}

/** 一次用户驱动的完整回复周期（turn）：user → 多次 provider call + tool → assistant 无 tool_call 结束 */
export interface TurnContext {
  /** turn 序号（递增，唯一标识；上层持久化 / 重放 / 增量同步用） */
  seq: number;
  /** 本 turn 累积消息（user + assistant + tool 结果，自闭环） */
  messages: LLMessage[];
  /** 本 turn 累计用量 */
  usage?: { inputTokens: number; outputTokens: number };
  /** 时间 */
  ts: string;
  /**
   * 追加消息到本 turn（触发上层 onTurnMessageAppend）
   * @param messages 本次追加的消息
   */
  appendTurnMessages(messages: LLMessage[]): void;
}

/** 当前 run 的运行状态：由 AgentRunConfig 初始化，nudge 策略判断依据（进度 + 工具使用记录） */
export interface RunContext {
  /** 当前 turn 序号 */
  curTurn: number;
  /** 最大轮次（来源于 AgentRunConfig.maxTurns，防死循环） */
  maxTurn: number;
  /** 各工具上次被调用的 turn 序号（name → turn） */
  toolsLastTurn: Map<string, number>;
}

/** AgentLoop 输入（inbox 队列元素）：turn 排队 / control 抢占 */
export type LoopInput =
  /** 追加用户消息（turn lane，FIFO 排队） */
  | {
      lane: "turn";
      kind: "followup";
      text: string;
      /** 入队时已预开的 turn（seq 按输入时序分配；执行时复用，不再开新 turn） */
      turn: TurnContext;
      /** 入队 run 的配置（run() 入队时带；直接 followup() 不带，用上次 config） */
      config?: AgentRunConfig;
      /** 入队 run 的事件回调 */
      onEvent?: (e: OutputEvent) => void;
      /** run() 入队时关联的结果 resolve id */
      resolveId?: string;
    }
  /** 转向指令（control lane，高优先级，注入 system reminder） */
  | { lane: "control"; kind: "steer"; text: string }
  /** 停止（control lane，取消当前 + 清空 turn 队列） */
  | { lane: "control"; kind: "stop" };

/** AgentLoop 运行结果（完整消息序列从 LoopContext.turns 取） */
export interface AgentLoopResult {
  /** 最终 assistant 消息 */
  final: AssistantMessage;
  /** 总 token 用量 */
  usage?: { inputTokens: number; outputTokens: number };
}

/** LoopContext 状态变化监听（上层订阅：持久化同步；方法可选，按需实现，可注册多个监听器） */
export interface LoopContextListener {
  /**
   * 新 turn 创建（用户消息开 turn，input 组装时触发）
   * @param turn 新 turn
   */
  onTurnAppended?(turn: TurnContext): void;
  /**
   * turn 消息追加（assistant / tool 结果；持久化增量追加）
   * @param turn 当前 turn
   * @param messages 本次追加的消息
   */
  onTurnMessageAppend?(turn: TurnContext, messages: LLMessage[]): void;
  /**
   * 上下文压缩后触发（持久化需全量重写）
   * @param turns 压缩后的 turn 序列（journal.write 覆盖）
   */
  onCompacted?(turns: TurnContext[]): void;
  /**
   * 上下文清空后触发（持久化需清空）
   */
  onClear?(): void;
}
