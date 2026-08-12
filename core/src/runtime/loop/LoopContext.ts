import type {
  ProviderCall,
  Message,
  ToolScheme,
  AssistantMessage,
} from "../provider/types.js";
import type { AgentDefinitionRegistry } from "../agent/AgentRegistry.js";
import type { CompactPolicyChain } from "../compact/CompactPolicyChain.js";
import type { ConversationJournalService } from "../../conversation/contract/journal.js";
import type { AgentRunConfig, RunContext } from "./types.js";

/** 会话上下文：messages 状态内部闭环，组合压缩策略链 + journal */
export class LoopContext {
  /** Agent 类型 */
  readonly agentType: string;
  /** Agent 版本 */
  readonly agentVersion: string;
  /** Agent 实例 id（main="main"；subagent 缺省） */
  readonly agentId?: string;

  /**
   * 构造 LoopContext
   * @param opts agent 标识 + 注册表 + 持久化 + 压缩策略链
   */
  constructor(opts: {
    agentId?: string;
    agentType: string;
    agentVersion: string;
    registry: AgentDefinitionRegistry;
    journal?: ConversationJournalService;
    compactPolicy: CompactPolicyChain;
  }) {
    this.agentId = opts.agentId;
    this.agentType = opts.agentType;
    this.agentVersion = opts.agentVersion;
    void opts.registry;
    void opts.journal;
    void opts.compactPolicy;
  }

  /** 追加用户消息（对外唯一输入口；创建新 run，内部处理 system reminder / 压缩 / 记录 / 持久化） */
  appendUserMessage(text: string): void {
    void text;
    throw new Error("LoopContext.appendUserMessage 尚未实现");
  }

  /** 追加 system reminder（对内，run 循环内部用） */
  appendSystemReminder(text: string): void {
    void text;
    throw new Error("LoopContext.appendSystemReminder 尚未实现");
  }

  /** 追加 assistant 消息（对内；含 toolCalls） */
  appendAssistant(msg: AssistantMessage): void {
    void msg;
    throw new Error("LoopContext.appendAssistant 尚未实现");
  }

  /** 追加 tool 结果（对内） */
  appendToolResponse(callId: string, text: string): void {
    void callId;
    void text;
    throw new Error("LoopContext.appendToolResponse 尚未实现");
  }

  /**
   * 上下文 → ProviderCall（run 时交给 provider）
   * @param run 单次运行配置
   * @param signal 取消信号
   * @returns 组装好的 ProviderCall
   */
  toProviderCall(run: AgentRunConfig, signal?: AbortSignal): ProviderCall {
    void run;
    void signal;
    throw new Error("LoopContext.toProviderCall 尚未实现");
  }

  /** 当前消息序列（最新回合的 turn 消息，便捷访问） */
  get messages(): Message[] {
    throw new Error("LoopContext.messages 尚未实现");
  }
  /** 当前系统提示词（注册表加载的 system 分段渲染） */
  get systemPrompt(): string {
    throw new Error("LoopContext.systemPrompt 尚未实现");
  }
  /** 当前工具 schemes（注册表加载的 toolDefs） */
  get toolSchemes(): ToolScheme[] {
    throw new Error("LoopContext.toolSchemes 尚未实现");
  }
  /** 最近回合记录（滑动窗口，只保留最近 N 轮） */
  get runs(): RunContext[] {
    throw new Error("LoopContext.runs 尚未实现");
  }
}
