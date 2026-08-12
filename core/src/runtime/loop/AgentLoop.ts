import type { Provider } from "../provider/Provider.js";
import type {
  ProviderCall,
  Message,
  ToolScheme,
  SamplingConfig,
  ToolCall,
  AssistantMessage,
} from "../provider/types.js";

/** 工具执行器：执行一次工具调用，返回结果文本 */
export interface ToolExecutor {
  /**
   * 执行一次工具调用
   * @param call 工具调用（含 id / name / args）
   * @returns 执行结果文本
   */
  execute(call: ToolCall): Promise<string>;
}

/** AgentLoop 事件（透给调用方；Conversation 据此转 OutputEvent） */
export type AgentLoopEvent =
  /** 文本增量 */
  | { type: "text-delta"; text: string }
  /** 推理/思考增量 */
  | { type: "reasoning-delta"; text: string }
  /** 工具调用（执行前发出） */
  | { type: "tool-call"; call: ToolCall }
  /** 工具执行结果 */
  | { type: "tool-result"; callId: string; text: string };

/** AgentLoop 构造配置：进程生命周期稳定 */
export interface AgentLoopConfig {
  /** Provider 实例 */
  provider: Provider;
  /** Agent 类型（决定 agent 定义/能力） */
  agentType: string;
  /** Agent 版本 */
  agentVersion: string;
}

/** 单次运行配置：run 时传入 */
export interface AgentRunConfig {
  /** 采样配置 */
  sampling: SamplingConfig;
  /** 最大轮次（防死循环） */
  maxTurns?: number;
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

/** 会话上下文：构造初始化，run 时累积状态 */
export class LoopContext {
  /** Agent 类型 */
  readonly agentType: string;
  /** Agent 版本 */
  readonly agentVersion: string;

  /**
   * 构造 LoopContext（agent 定义：system / tools / executor 按 agentType 加载，待实现）
   * @param opts agent 标识
   */
  constructor(opts: { agentType: string; agentVersion: string }) {
    this.agentType = opts.agentType;
    this.agentVersion = opts.agentVersion;
  }

  /**
   * 追加用户消息
   * @param text 用户消息文本
   */
  appendUserMessage(text: string): void {
    void text;
    throw new Error("LoopContext.appendUserMessage 尚未实现");
  }

  /**
   * 追加消息（assistant / tool 结果 / SystemMessage reminder）
   * @param msg 中立消息
   */
  appendMessage(msg: Message): void {
    void msg;
    throw new Error("LoopContext.appendMessage 尚未实现");
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

  /** 当前消息序列 */
  get messages(): Message[] {
    throw new Error("LoopContext.messages 尚未实现");
  }
}

/** AgentLoop：agent 主循环 */
export class AgentLoop {
  /** 构造配置 */
  private readonly config: AgentLoopConfig;
  /** 会话上下文（构造时初始化） */
  private readonly context: LoopContext;

  /**
   * 构造 AgentLoop
   * @param config 构造配置（Provider + agent 标识）
   */
  constructor(config: AgentLoopConfig) {
    this.config = config;
    this.context = new LoopContext({
      agentType: config.agentType,
      agentVersion: config.agentVersion,
    });
  }

  /**
   * 运行一轮对话：追加用户消息 → 循环调 provider，处理 tool_call，直至 stop / length / maxTurns
   * @param input 用户消息文本
   * @param runConfig 单次运行配置
   * @param onEvent 事件回调（delta / tool-call / tool-result）
   * @returns 运行结果
   */
  run(
    input: string,
    runConfig: AgentRunConfig,
    onEvent?: (e: AgentLoopEvent) => void,
  ): Promise<AgentLoopResult> {
    void input;
    void runConfig;
    void onEvent;
    throw new Error("AgentLoop.run 尚未实现");
  }

  /**
   * 取消当前 run
   */
  cancel(): void {
    throw new Error("AgentLoop.cancel 尚未实现");
  }
}
