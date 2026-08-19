import type { Provider } from "../provider/Provider.js";
import type {
  LLMessage,
  ToolScheme,
  SamplingConfig,
  ToolCall,
  AssistantMessage,
} from "../provider/types.js";
import type { ComposeModeStateProvider } from "../../conversation/compose/index.js";
import type { AgentCapability } from "../agent/AgentCapability.js";
import type {
  CaseGuideProvider,
  NovelConstraintsProvider,
} from "../prompt/PromptSection.js";
import type { ToolDispatcher } from "../tool/ToolDispatcher.js";
import type { Logger } from "../../log/Logger.js";
import type { ProviderCallDebugger } from "../debug/ProviderCallDebugger.js";
import type { AssistantDeltaEvent, OutputEvent } from "../../conversation/contract/events/index.js";
import type {
  ConversationApprovalDecision,
  ConversationApprovalRequest,
} from "../../conversation/contract/types/index.js";

/**
 * AgentLoop 产出全集：持久化域 OutputEvent + 流域瞬态 delta（单流保序）。
 * 域分流（持久化域 → journal、流域 → 投影）由上层 ProjectionLayer 承担，loop 不区分。
 */
export type LoopEvent = OutputEvent | AssistantDeltaEvent;

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
  /** 可恢复的 run 消息（上次会话；缺省从空开始） */
  runMessages?: LLMessage[];
  /**
   * 按 run 边界恢复（journal 重放，压缩分区/摘要标记跨重启保持；提供时优先于 runMessages）
   */
  restoreRuns?: readonly { seq: number; messages: LLMessage[]; ts?: string }[];
  /** run seq 起始值（journal 恢复：重放后的下个 run 从 resumeSeq+1 开始） */
  startSeq?: number;
  /** 状态变化监听器（AgentLoop 构造时注册到 LoopContext；可多个） */
  listeners?: LoopContextListener[];
  /**
   * 宿主平台显示名（core.environment 动态段；进程常量，构造注入一次）。
   * 缺省不渲染环境块。
   */
  platform?: string;
  /**
   * 小说全局约束提供者：每 provider call 前调用（node 层 fs 读取 NOVEL.md）。
   * 读取失败返回 undefined → 动态段渲染占位。workdir/modelId 不注入——
   * LoopContext 以 workspace / run.sampling.model 自行组装。
   */
  novelConstraintsProvider?: NovelConstraintsProvider;
  /**
   * 案例引导提供者：每 provider call 前调用（node 层扫描 .novel/cases 派生条目）。
   * 返回 undefined → 质量规范段仅省略「参考案例」小节（正文恒渲染）。
   */
  caseGuideProvider?: CaseGuideProvider;
  /**
   * spawn seed 消息：首 run 开启后、首个 provider call 前调用一次，带 run 输入
   * 文本（builder 同步执行拿不到委派 prompt，意图分类在 run 内做）；结果以
   * persistent append 注入首 run（novel-guide 案例正文，紧随 user 消息）。
   * 钩子异常由 loop 吞掉不阻断任务。子代理单 run 场景专用。
   */
  spawnSeedMessages?: (input: string) => Promise<LLMessage[] | undefined>;
  /**
   * 审批通道：requireApproval 工具执行前征询（子进程内闭包，不跨 RPC）。
   * 未注入时 requireApproval 工具按拒绝处理（返回「已拒绝（审批通道未装配）」），
   * 保证无 UI / 测试环境可用。
   */
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>;
  /**
   * 暂停点续跑决策器：恢复 run 中缺 tool 结果的 toolCall 经此查询决策
   * （approve 执行 / reject 已拒绝 / expired 审批超时 / undefined 通道未装配）。
   * 由子进程启动时经 CMS takeDecisions 装配（重启补完路径）。
   */
  resumePendingDecider?: (toolCallId: string) => Promise<"approve" | "reject" | "expired" | undefined>;
  /** 结构化日志（上层 createLogger 注入；缺省不打日志） */
  logger?: Logger;
  /** ProviderCall 调试器（debug 模式注入；记录每次请求 + 相邻差异，jsonl + html） */
  debugger?: ProviderCallDebugger;
  /**
   * compose 状态提供者（gateBatch 权限门：compose 激活 deny canonical 写、
   * bypass 放行；缺省 fail-open 走基础策略——未注入 = 按未激活处理）
   */
  composeState?: ComposeModeStateProvider;
  /**
   * 每次 provider call 发起前回调（toProviderCall 步骤⓪ await：mode pending→active 晋升等；
   * 在压缩/动态段渲染/nudge/权限门控之前执行）
   */
  beforeProviderCall?: () => void | Promise<void>;
}

/** 单次运行配置：run 时传入 */
export interface AgentRunConfig {
  /** 采样配置 */
  sampling: SamplingConfig;
  /** 最大轮次（防死循环） */
  maxTurns?: number;
}

/** 一次用户消息驱动的完整回复周期（run）：user → 多次 provider call（turn）+ tool → assistant 无 tool_call 结束 */
export interface RunContext {
  /** run 序号（递增，唯一标识；上层持久化 / 重放 / 增量同步用） */
  seq: number;
  /** 本 run 累积消息（user + assistant + tool 结果，自闭环） */
  messages: LLMessage[];
  /** 本 run 累计用量 */
  usage?: { inputTokens: number; outputTokens: number };
  /**
   * 最近一次 provider call 的输入 token（= 那次调用时的完整上下文占用，含 system/tools；
   * 压缩策略阈值信号。区别于 usage 的跨 turn 累加语义）
   */
  lastInputTokens?: number;
  /** 记录信号时全部 run 消息的字符总量（压缩后按 charsNow/signalChars 比例重估占用） */
  signalChars?: number;
  /** 本 run 最近一次 provider call 使用的模型名（压缩策略查窗口用） */
  model?: string;
  /** 本 run 最近一次 provider call 的输出上限（T2 阈值公式用） */
  maxOutputTokens?: number;
  /** 时间 */
  ts: string;
  /**
   * 追加消息到本 run（触发上层 onRunMessageAppend）
   * @param messages 本次追加的消息
   */
  appendRunMessages(messages: LLMessage[]): void;
}

/** 当前 run 的运行进度：由 AgentRunConfig 初始化，nudge 策略判断依据（进度 + 工具使用记录） */
export interface RunProgress {
  /** 当前请求轮（turn = 一次 API 请求）序号 */
  curTurn: number;
  /** 最大轮次（来源于 AgentRunConfig.maxTurns = 每 run 最大 turn 数，防死循环） */
  maxTurn: number;
  /** 各工具上次被调用的 turn（请求轮）序号（name → turn） */
  toolsLastTurn: Map<string, number>;
}

/** AgentLoop 输入（inbox 队列元素）：run 排队 / control 抢占 */
export type LoopInput =
  /** 追加用户消息（run lane，FIFO 排队） */
  | {
      lane: "run";
      kind: "followup";
      text: string;
      /** 入队时已预开的 run（seq 按输入时序分配；执行时复用，不再开新 run） */
      run: RunContext;
      /** 入队 run 的配置（run() 入队时带；直接 followup() 不带，用上次 config） */
      config?: AgentRunConfig;
      /** 入队 run 的事件回调 */
      onEvent?: (e: LoopEvent) => void;
      /** run() 入队时关联的结果 resolve id */
      resolveId?: string;
    }
  /** 转向指令（control lane，高优先级，注入 system reminder） */
  | { lane: "control"; kind: "steer"; text: string }
  /** 停止（control lane，取消当前 + 清空 run 队列） */
  | { lane: "control"; kind: "stop" };

/** AgentLoop 运行结果（完整消息序列从 LoopContext.runs 取） */
export interface AgentLoopResult {
  /** 最终 assistant 消息 */
  final: AssistantMessage;
  /** 总 token 用量 */
  usage?: { inputTokens: number; outputTokens: number };
}

/** LoopContext 状态变化监听（上层订阅：持久化同步；方法可选，按需实现，可注册多个监听器） */
export interface LoopContextListener {
  /**
   * 新 run 创建（用户消息开 run，input 组装时触发）
   * @param run 新 run
   */
  onRunAppended?(run: RunContext): void;
  /**
   * run 消息追加（assistant / tool 结果；持久化增量追加）
   * @param run 当前 run
   * @param messages 本次追加的消息
   */
  onRunMessageAppend?(run: RunContext, messages: LLMessage[]): void;
  /**
   * 上下文压缩后触发（持久化需全量重写）
   * @param runs 压缩后的 run 序列（journal.write 覆盖）
   */
  onCompacted?(runs: RunContext[]): void;
  /**
   * 上下文清空后触发（持久化需清空）
   */
  onClear?(): void;
}
