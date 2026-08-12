import type { Provider } from "../provider/Provider.js";
import type {
  Message,
  ToolScheme,
  SamplingConfig,
  ToolCall,
  AssistantMessage,
} from "../provider/types.js";
import type { AgentDefinitionRegistry } from "../agent/AgentRegistry.js";
import type { CompactPolicyChain } from "../compact/CompactPolicyChain.js";

/** AgentLoop 事件（透给调用方；Conversation 据此转 OutputEvent） */
export type AgentLoopEvent =
  /** 文本增量 */
  | { type: "text-delta"; text: string }
  /** 推理/思考增量 */
  | { type: "reasoning-delta"; text: string }
  /** 工具调用（执行前发出） */
  | { type: "tool-call"; call: ToolCall }
  /** 工具执行结果 */
  | { type: "tool-result"; callId: string; text: string }
  /** 上下文压缩发生 */
  | { type: "compacted" }
  /** 上下文清空 */
  | { type: "clear" }
  /** 重试请求 */
  | { type: "retry-request" };

/** AgentLoop 构造配置：进程生命周期稳定 */
export interface AgentLoopConfig {
  /** 工作区路径（agent 文件操作环境） */
  workspace: string;
  /** Provider 实例 */
  provider: Provider;
  /** Agent 类型（决定 agent 定义/能力） */
  agentType: string;
  /** Agent 版本 */
  agentVersion: string;
  /** Agent 实例 id：main 传 "main"（持久化）；subagent 缺省 */
  agentId?: string;
  /** Agent 定义注册表（加载 system 分段 / 工具定义） */
  registry: AgentDefinitionRegistry;
  /** 上下文压缩策略链 */
  compactPolicy: CompactPolicyChain;
  /** 状态变化监听器（AgentLoop 构造时注册到 LoopContext；可多个） */
  listeners?: LoopContextListener[];
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
  messages: Message[];
  /** 本 turn 累计用量 */
  usage?: { inputTokens: number; outputTokens: number };
  /** 时间 */
  ts: string;
}

/** AgentLoop 运行结果（完整消息序列从 LoopContext.turns 取） */
export interface AgentLoopResult {
  /** 最终 assistant 消息 */
  final: AssistantMessage;
  /** 总 token 用量 */
  usage?: { inputTokens: number; outputTokens: number };
}

/** LoopContext 状态变化监听（上层订阅：持久化 / 通知；方法可选，按需实现，可注册多个监听器） */
export interface LoopContextListener {
  /**
   * 新 turn 创建（用户消息开 turn）
   * @param turn 新 turn
   */
  onTurnAppended?(turn: TurnContext): void;
  /**
   * turn 消息追加（assistant / tool 结果）
   * @param turn 当前 turn
   * @param messages 本次追加的消息
   */
  onTurnMessageAppend?(turn: TurnContext, messages: Message[]): void;
  /**
   * 上下文压缩发生
   */
  onCompacted?(): void;
  /**
   * 上下文清空 / 重置（如切换任务、子代理结束）
   */
  onClear?(): void;
}
