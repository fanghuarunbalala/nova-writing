import type {
  ProviderCall,
  LLMessage,
  ToolScheme,
} from "../provider/types.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type {
  DynamicPromptSectionInput,
  NovelConstraintsProvider,
} from "../prompt/PromptSection.js";
import { CompactPolicyChainImpl } from "../compact/CompactPolicyChainImpl.js";
import type {
  AgentRunConfig,
  RunContext,
  LoopContextListener,
  RunProgress,
} from "./types.js";

/** 保留最近 run 数（滑动窗口） */
const MAX_RUNS = 50;

/** LoopContext 只读视图：工具执行 / system 渲染可访问，不可修改 */
export interface ReadonlyLoopContext {
  /** 工作区路径（工具文件操作环境） */
  readonly workspace: string;
  /** 当前消息序列 */
  readonly messages: LLMessage[];
  /** 当前系统提示词（渲染后） */
  readonly systemPrompt: string;
  /** 当前工具 schemes */
  readonly toolSchemes: ToolScheme[];
  /** 最近 run 记录 */
  readonly runs: RunContext[];
}

/** 会话上下文：run 状态内部闭环；压缩/提示在 toProviderCall 触发；持久化由上层订阅状态变化自行处理 */
export class LoopContext implements ReadonlyLoopContext {
  /** 工作区路径 */
  readonly workspace: string;
  /** Agent 能力（初始化传入：system 分段 + 工具定义 + 策略） */
  readonly agentCapability: AgentCapability;

  /** 最近 run 记录（滑动窗口，内部存储） */
  private runList: RunContext[] = [];
  /** 状态监听器（可多个） */
  private listeners: LoopContextListener[] = [];
  /** run 序号递增器 */
  private seq = 0;
  /** 压缩策略链（注册 agentCapability.compactPolicies） */
  private compactChain = new CompactPolicyChainImpl();
  /** 静态 system 分段 base 缓存（全部 static 段一次渲染；dynamic 段不进 base） */
  private staticBase?: string;
  /** 最近一次渲染的完整 system prompt（systemPrompt getter 语义） */
  private lastSystemPrompt?: string;
  /** 宿主平台显示名（构造注入一次；缺省不渲染环境块） */
  readonly platform?: string;
  /** 小说全局约束提供者（每 provider call 前调用；缺省空——动态段渲染占位） */
  private readonly novelConstraintsProvider: NovelConstraintsProvider;

  /**
   * 构造 LoopContext
   * @param opts Agent 能力 + 工作区 + 可恢复的 run 消息 + seq 起始值（journal 恢复用）
   * + 平台显示名（环境块，进程常量）+ NOVEL.md 提供者（每调用 fs 读，node 层注入）
   */
  constructor(opts: {
    agentCapability: AgentCapability;
    workspace: string;
    runMessages?: LLMessage[];
    startSeq?: number;
    platform?: string;
    novelConstraintsProvider?: NovelConstraintsProvider;
  }) {
    this.agentCapability = opts.agentCapability;
    this.workspace = opts.workspace;
    this.seq = opts.startSeq ?? 0;
    this.platform = opts.platform;
    this.novelConstraintsProvider = opts.novelConstraintsProvider ?? (async () => undefined);
    for (const policy of opts.agentCapability.compactPolicies) {
      this.compactChain.register(policy, 0);
    }
    // 恢复上次会话（不触发 onRunAppended）；恢复 run 沿用 journal 最后 seq
    // （= startSeq，不消耗新号）——暂停点续跑时补完消息同 seq 重写原快照，
    // 后续新 run 从 startSeq+1 起
    if (opts.runMessages && opts.runMessages.length > 0) {
      const restored = [...opts.runMessages];
      this.runList.push({
        seq: this.seq,
        messages: restored,
        ts: new Date().toISOString(),
        appendRunMessages: (m) => {
          restored.push(...m);
        },
      });
    }
  }

  /**
   * 订阅状态变化（run 追加 / 消息追加 / 压缩 / 清空）；可多次调用注册多个监听器
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
   * 开新 run（input 组装时：seq 递增，含用户消息；触发 onRunAppended）
   * @param run 新 run（含用户消息 / usage；seq 由 LoopContext 覆盖分配）
   */
  appendRun(run: RunContext): void {
    run.seq = ++this.seq;
    this.runList.push(run);
    if (this.runList.length > MAX_RUNS) this.runList.shift();
    this.notify((l) => l.onRunAppended?.(run));
  }

  /**
   * 追加消息到当前 run（后续所有增量：assistant / tool 结果；触发 onRunMessageAppend）
   * @param messages 本次追加的消息
   */
  appendRunMessages(messages: LLMessage[]): void {
    const run = this.runList.at(-1);
    if (!run) return;
    run.messages.push(...messages);
    this.notify((l) => l.onRunMessageAppend?.(run, messages));
  }

  /**
   * 组装下一次 ProviderCall：触发压缩（compactIfNeeded，影响 runs）+ 组装动态段输入
   * （workdir=this.workspace、platform=构造注入常量、modelId=run.sampling.model；
   * NOVEL.md 内容经宿主 provider 每调用读取）+ 收集 nudge（persistent 追加 /
   * transient 改 call）+ 生成 system（static base 缓存 + dynamic 每调用渲染 + 工具 promptDetail）
   * @param run 单次运行配置
   * @param runProgress 当前 run 运行进度（nudge 判断依据）
   * @param signal 取消信号
   * @returns 组装好的 ProviderCall
   */
  async toProviderCall(
    run: AgentRunConfig,
    runProgress: RunProgress,
    signal?: AbortSignal,
  ): Promise<ProviderCall> {
    // ① 压缩（链式，影响 runs）
    if (this.compactChain.compactIfNeeded(this)) {
      this.notify((l) => l.onCompacted?.(this.runList));
    }
    // ② 动态段输入：LoopContext 自组装 + 宿主注入约束内容（每调用重读）
    const constraints = await this.novelConstraintsProvider();
    const dynamicInput: DynamicPromptSectionInput = {
      environment:
        this.platform === undefined || this.platform.trim().length === 0
          ? undefined
          : {
              workdir: this.workspace,
              platform: this.platform,
              modelId: run.sampling.model,
            },
      ...(constraints === undefined ? {} : { novelGlobalConstraints: constraints }),
    };
    // ③ 组装基础请求（system / tools / messages / sampling）
    const call: ProviderCall = {
      system: this.renderSystem(dynamicInput),
      tools: this.toolSchemes,
      messages: this.messages,
      sampling: run.sampling,
      signal,
    };
    // ④ nudge：persistent（内部 append → onRunMessageAppend）/ transient（原地改 call）
    for (const policy of this.agentCapability.nudgePolicies) {
      policy.persistentNudgeIfNeeded(this, runProgress);
      policy.transientNudgeIfNeeded(this, runProgress, call);
    }
    return call;
  }

  /** 汇总消息序列（所有 run 的消息平铺，完整对话历史） */
  get messages(): LLMessage[] {
    return this.runList.flatMap((r) => r.messages);
  }
  /** 当前系统提示词：最近一次渲染值（未渲染过时以空动态输入渲染一次，供工具/静态段读取） */
  get systemPrompt(): string {
    return this.lastSystemPrompt ?? this.renderSystem({});
  }
  /** 当前工具 schemes（agentCapability.toolDefs） */
  get toolSchemes(): ToolScheme[] {
    return this.agentCapability.toolDefs;
  }
  /** 最近 run 记录（滑动窗口） */
  get runs(): RunContext[] {
    return this.runList;
  }

  /**
   * 渲染静态 base：全部 static 段各渲染一次拼接缓存。
   * （修复：旧实现以单字符串缓存首段，后续 static 段全部被首段内容替换，从未进入 prompt）
   * @returns 静态 base 文本
   */
  private renderStaticBase(): string {
    const parts: string[] = [];
    for (const section of this.agentCapability.systemSections) {
      if (section.kind === "static") {
        parts.push(section.render(this));
      }
    }
    return parts.join("\n");
  }

  /**
   * 渲染完整 system：静态 base（一次缓存）+ 动态分段（每调用）+ 工具 promptDetail。
   * 渲染结果记为最近一次渲染值（systemPrompt getter）。
   * @param input 动态段输入（宿主注入 + modelId 补齐）
   * @returns 完整 system 文本
   */
  private renderSystem(input: DynamicPromptSectionInput): string {
    if (this.staticBase === undefined) {
      this.staticBase = this.renderStaticBase();
    }
    const parts: string[] = [];
    if (this.staticBase.length > 0) parts.push(this.staticBase);
    for (const section of this.agentCapability.systemSections) {
      if (section.kind === "dynamic") {
        const rendered = section.renderDynamic(input, this);
        if (rendered.length > 0) parts.push(rendered);
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
    this.lastSystemPrompt = parts.join("\n");
    return this.lastSystemPrompt;
  }

  /** 通知所有监听器 */
  private notify(fn: (l: LoopContextListener) => void): void {
    for (const l of this.listeners) {
      fn(l);
    }
  }
}
