import type { Provider } from "../provider/Provider.js";
import type {
  Message,
  ToolScheme,
  SamplingConfig,
  ToolCall,
  AssistantMessage,
} from "../provider/types.js";
import type { ConversationJournalService } from "../../conversation/contract/journal.js";
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
  | { type: "compacted" };

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
  /** 持久化服务（journal 写侧）；subagent 不持久化，缺省 */
  journal?: ConversationJournalService;
  /** 上下文压缩策略链 */
  compactPolicy: CompactPolicyChain;
}

/** 单次运行配置：run 时传入 */
export interface AgentRunConfig {
  /** 采样配置 */
  sampling: SamplingConfig;
  /** 最大轮次（防死循环） */
  maxTurns?: number;
}

/** 一次 provider call（turn）：run 内最小单位 */
export interface TurnContext {
  /** 本次 call 的消息（末尾 assistant 即 final 来源） */
  messages: Message[];
  /** 本次 call 用量 */
  usage?: { inputTokens: number; outputTokens: number };
  /** 时间 */
  ts: string;
}

/** 一次 run（完整回合）：final / 总 usage 派生自 turns */
export interface RunContext {
  /** 本回合 turn 序列（每次 provider call 一个） */
  turns: TurnContext[];
  /** 时间 */
  ts: string;
}

/** AgentLoop 运行结果 */
export interface AgentLoopResult {
  /** 本轮完整消息序列（含 tool 轮次） */
  messages: Message[];
  /** 最终 assistant 消息 */
  final: AssistantMessage;
  /** 总 token 用量 */
  usage?: { inputTokens: number; outputTokens: number };
}
