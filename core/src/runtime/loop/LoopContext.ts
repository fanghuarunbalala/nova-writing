import type {
  ProviderCall,
  Message,
  ToolScheme,
} from "../provider/types.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import { CompactPolicyChainImpl } from "../compact/CompactPolicyChainImpl.js";
import type {
  AgentRunConfig,
  TurnContext,
  LoopContextListener,
  RunContext,
} from "./types.js";

/** 保留最近 turn 数（滑动窗口） */
const MAX_TURNS = 50;

/** LoopContext 只读视图：工具执行 / system 渲染可访问，不可修改 */
export interface ReadonlyLoopContext {
  /** 工作区路径（工具文件操作环境） */
  readonly workspace: string;
  /** 当前消息序列 */
  readonly messages: Message[];
  /** 当前系统提示词（渲染后） */
  readonly systemPrompt: string;
  /** 当前工具 schemes */
  readonly toolSchemes: ToolScheme[];
  /** 最近 turn 记录 */
  readonly turns: TurnContext[];
}

/** 会话上下文：turn 状态内部闭环；压缩/提示在 toProviderCall 触发；持久化由上层订阅状态变化自行处理 */
export class LoopContext implements ReadonlyLoopContext {
  /** 工作区路径 */
  readonly workspace: string;
  /** Agent 能力（初始化传入：system 分段 + 工具定义 + 策略） */
  readonly agentCapability: AgentCapability;

  /** 最近 turn 记录（滑动窗口，内部存储） */
  private turnList: TurnContext[] = [];
  /** 状态监听器（可多个） */
  private listeners: LoopContextListener[] = [];
  /** turn 序号递增器 */
  private seq = 0;
  /** 压缩策略链（注册 agentCapability.compactPolicies） */
  private compactChain = new CompactPolicyChainImpl();
  /** 静态 system 分段渲染缓存 */
  private staticSystemCache?: string;

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
    for (const policy of opts.agentCapability.compactPolicies) {
      this.compactChain.register(policy, 0);
    }
    // 恢复上次会话（不触发 onTurnAppended）
    if (opts.turnMessages && opts.turnMessages.length > 0) {
      this.turnList.push(this.createTurn(opts.turnMessages));
    }
  }

  /**
   * 订阅状态变化（turn 追加 / 消息追加 / 压缩 / 清空）；可多次调用注册多个监听器
   * @param listener 监听器（方法可选，按需实现）
   * @returns 取消该监听器的订阅函数
   */
  subscribe(listener: LoopContextListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * 开新 turn（input 组装时：seq 递增，含用户消息；触发 onTurnAppended）
   * @param turn 新 turn（含用户消息 / usage；seq 由 LoopContext 覆盖分配）
   */
  appendTurnContext(turn: TurnContext): void {
    turn.seq = ++this.seq;
    this.turnList.push(turn);
    if (this.turnList.length > MAX_TURNS) this.turnList.shift();
    this.notify((l) => l.onTurnAppended?.(turn));
  }

  /**
   * 追加消息到当前 turn（后续所有增量：assistant / tool 结果；触发 onTurnMessageAppend）
   * @param messages 本次追加的消息
   */
  appendTurnMessages(messages: Message[]): void {
    const turn = this.turnList.at(-1);
    if (!turn) return;
    turn.messages.push(...messages);
    this.notify((l) => l.onTurnMessageAppend?.(turn, messages));
  }

  /**
   * 组装下一次 ProviderCall：触发压缩（compactIfNeeded，影响 turns）+ 收集 nudge（persistent 追加 / transient 改 call）
   * + 生成动态 system（systemSections 渲染 + toolDefs promptDetail）
   * @param run 单次运行配置
   * @param runContext 当前 run 运行状态（nudge 判断依据）
   * @param signal 取消信号
   * @returns 组装好的 ProviderCall
   */
  toProviderCall(run: AgentRunConfig, runContext: RunContext, signal?: AbortSignal): ProviderCall {
    // ① 压缩（链式，影响 turns）
    if (this.compactChain.compactIfNeeded(this)) {
      this.notify((l) => l.onCompacted?.(this.turnList));
    }
    // ② 组装基础请求（system / tools / messages / sampling）
    const call: ProviderCall = {
      system: this.renderSystem(),
      tools: this.toolSchemes,
      messages: this.messages,
      sampling: run.sampling,
      signal,
    };
    // ③ nudge：persistent（内部 append → onTurnMessageAppend）/ transient（原地改 call）
    for (const policy of this.agentCapability.nudgePolicies) {
      policy.persistentNudgeIfNeeded(this, runContext);
      policy.transientNudgeIfNeeded(this, runContext, call);
    }
    return call;
  }

  /** 汇总消息序列（所有 turn 的消息平铺，完整对话历史） */
  get messages(): Message[] {
    return this.turnList.flatMap((t) => t.messages);
  }
  /** 当前系统提示词（静态分段缓存 + 动态渲染 + 工具 promptDetail） */
  get systemPrompt(): string {
    return this.renderSystem();
  }
  /** 当前工具 schemes（agentCapability.toolDefs） */
  get toolSchemes(): ToolScheme[] {
    return this.agentCapability.toolDefs;
  }
  /** 最近 turn 记录（滑动窗口） */
  get turns(): TurnContext[] {
    return this.turnList;
  }

  /** 创建 turn（绑定 appendTurnMessages 闭包） */
  private createTurn(messages: Message[]): TurnContext {
    const msgs = [...messages];
    return {
      seq: ++this.seq,
      messages: msgs,
      ts: new Date().toISOString(),
      appendTurnMessages: (m) => {
        msgs.push(...m);
      },
    };
  }

  /** 渲染 system：静态分段（缓存）+ 动态分段（每次）+ 工具 promptDetail */
  private renderSystem(): string {
    const parts: string[] = [];
    for (const section of this.agentCapability.systemSections) {
      if (section.kind === "static") {
        if (this.staticSystemCache === undefined) {
          this.staticSystemCache = section.render(this);
        }
        parts.push(this.staticSystemCache);
      } else {
        parts.push(section.render(this));
      }
    }
    for (const tool of this.agentCapability.toolDefs) {
      if (tool.promptDetail?.policy) {
        parts.push(`# ToolPolicy\n${tool.promptDetail.policy}`);
      }
      if (tool.promptDetail?.guidance) {
        parts.push(tool.promptDetail.guidance);
      }
    }
    return parts.join("\n");
  }

  /** 通知所有监听器 */
  private notify(fn: (l: LoopContextListener) => void): void {
    for (const l of this.listeners) {
      fn(l);
    }
  }
}
