import type {
  ProviderCall,
  Message,
  ToolScheme,
} from "../provider/types.js";
import type { AgentDefinitionRegistry } from "../agent/AgentRegistry.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type { CompactPolicyChain } from "../compact/CompactPolicyChain.js";
import type {
  AgentRunConfig,
  TurnContext,
  LoopContextListener,
} from "./types.js";

/** LoopContext 只读视图：工具执行 / system 渲染可访问，不可修改 */
export interface ReadonlyLoopContext {
  /** Agent 类型 */
  readonly agentType: string;
  /** Agent 版本 */
  readonly agentVersion: string;
  /** Agent 实例 id（main="main"；subagent 缺省） */
  readonly agentId?: string;
  /** 当前消息序列 */
  readonly messages: Message[];
  /** 当前系统提示词（渲染后） */
  readonly systemPrompt: string;
  /** 当前工具 schemes */
  readonly toolSchemes: ToolScheme[];
  /** 最近 turn 记录 */
  readonly turns: TurnContext[];
}

/** 会话上下文：turn 状态内部闭环，组合压缩策略链；持久化由上层订阅状态变化自行处理 */
export class LoopContext implements ReadonlyLoopContext {
  /** Agent 类型 */
  readonly agentType: string;
  /** Agent 版本 */
  readonly agentVersion: string;
  /** Agent 实例 id（main="main"；subagent 缺省） */
  readonly agentId?: string;
  /** 是否 main agent（agentId === "main"） */
  readonly isMainAgent: boolean;
  /** Agent 能力（注册表加载：system 分段 + 工具定义） */
  readonly agentCapability: AgentCapability;

  /**
   * 构造 LoopContext
   * @param opts agent 标识 + 注册表 + 压缩策略链
   */
  constructor(opts: {
    agentId?: string;
    agentType: string;
    agentVersion: string;
    registry: AgentDefinitionRegistry;
    compactPolicy: CompactPolicyChain;
  }) {
    this.agentId = opts.agentId;
    this.agentType = opts.agentType;
    this.agentVersion = opts.agentVersion;
    this.isMainAgent = opts.agentId === "main";
    this.agentCapability = opts.registry.get(opts.agentType, opts.agentVersion);
    void opts.compactPolicy;
  }

  /**
   * 订阅状态变化（turn 追加 / 消息追加 / 压缩 / 清空）；可多次调用注册多个监听器
   * @param listener 监听器（方法可选，按需实现）
   * @returns 取消该监听器的订阅函数
   */
  subscribe(listener: LoopContextListener): () => void {
    void listener;
    throw new Error("LoopContext.subscribe 尚未实现");
  }

  /**
   * 推入/更新当前 turn（用户消息开 turn，或 call / tool 结果追加；完成后存档最近 N）
   * @param turn 当前 turn（含累积 messages / usage）
   */
  appendTurnContext(turn: TurnContext): void {
    void turn;
    throw new Error("LoopContext.appendTurnContext 尚未实现");
  }

  /**
   * 组装下一次 ProviderCall：触发压缩判断（compactIfNeeded）+ 生成动态 system（含 reminder，基于 turns 上下文）
   * @param run 单次运行配置
   * @param signal 取消信号
   * @returns 组装好的 ProviderCall
   */
  toProviderCall(run: AgentRunConfig, signal?: AbortSignal): ProviderCall {
    void run;
    void signal;
    throw new Error("LoopContext.toProviderCall 尚未实现");
  }

  /** 当前消息序列（最新 turn 的 messages，便捷访问） */
  get messages(): Message[] {
    throw new Error("LoopContext.messages 尚未实现");
  }
  /** 当前系统提示词（agentCapability.systemSections 渲染，静态缓存 / 动态每次） */
  get systemPrompt(): string {
    throw new Error("LoopContext.systemPrompt 尚未实现");
  }
  /** 当前工具 schemes（agentCapability.toolDefs） */
  get toolSchemes(): ToolScheme[] {
    throw new Error("LoopContext.toolSchemes 尚未实现");
  }
  /** 最近 turn 记录（滑动窗口，只保留最近 N 轮） */
  get turns(): TurnContext[] {
    throw new Error("LoopContext.turns 尚未实现");
  }
}
