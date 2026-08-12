import type {
  ProviderCall,
  Message,
  ToolScheme,
} from "../provider/types.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type {
  AgentRunConfig,
  TurnContext,
  LoopContextListener,
  RunContext,
} from "./types.js";

/** LoopContext 只读视图：工具执行 / system 渲染可访问，不可修改 */
export interface ReadonlyLoopContext {
  /** 工作区路径（工具文件操作环境） */
  readonly workspace: string;
  /** 汇总消息序列 */
  readonly messages: Message[];
  /** 当前系统提示词（渲染后） */
  readonly systemPrompt: string;
  /** 当前工具 schemes */
  readonly toolSchemes: ToolScheme[];
  /** 最近 turn 记录 */
  readonly turns: TurnContext[];
}

/** 会话上下文：由 AgentCapability 初始化；turn 状态闭环；压缩/提示在 toProviderCall 触发；持久化由上层订阅自行处理 */
export class LoopContext implements ReadonlyLoopContext {
  /** 工作区路径 */
  readonly workspace: string;
  /** Agent 能力（初始化传入：system 分段 + 工具定义 + 策略） */
  readonly agentCapability: AgentCapability;

  /**
   * 构造 LoopContext
   * @param opts Agent 能力 + 工作区 + 可恢复的 turn 消息
   */
  constructor(opts: {
    agentCapability: AgentCapability;
    workspace: string;
    turnMessages?: Message[];
  }) {
    this.agentCapability = opts.agentCapability;
    this.workspace = opts.workspace;
    void opts.turnMessages;
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
   * 开新 turn（input 组装时：seq 递增，含用户消息；触发 onTurnAppended）
   * @param turn 新 turn（含用户消息 / usage）
   */
  appendTurnContext(turn: TurnContext): void {
    void turn;
    throw new Error("LoopContext.appendTurnContext 尚未实现");
  }

  /**
   * 追加消息到当前 turn（后续所有增量：assistant / tool 结果；由 loop 实现并触发 onTurnMessageAppend）
   * @param messages 本次追加的消息
   */
  appendTurnMessages(messages: Message[]): void {
    void messages;
    throw new Error("LoopContext.appendTurnMessages 尚未实现");
  }

  /**
   * 组装下一次 ProviderCall：触发压缩（compactIfNeeded，影响 turns）+ 收集 nudge（append 进 turns / transient 本次）
   * + 生成动态 system（systemSections 渲染）
   * @param run 单次运行配置
   * @param runContext 当前 run 运行状态（nudge 判断依据）
   * @param signal 取消信号
   * @returns 组装好的 ProviderCall
   */
  toProviderCall(run: AgentRunConfig, runContext: RunContext, signal?: AbortSignal): ProviderCall {
    void run;
    void runContext;
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
