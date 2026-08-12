import type {
  AgentLoopConfig,
  AgentLoopResult,
  AgentRunConfig,
  AgentLoopEvent,
} from "./types.js";
import { LoopContext } from "./LoopContext.js";

/** AgentLoop：agent 主循环 */
export class AgentLoop {
  /** 构造配置 */
  private readonly config: AgentLoopConfig;
  /** 会话上下文（构造时初始化） */
  private readonly context: LoopContext;

  /**
   * 构造 AgentLoop
   * @param config 构造配置（workspace + Provider + agent 标识 + 注册表 + 压缩策略链）
   */
  constructor(config: AgentLoopConfig) {
    this.config = config;
    this.context = new LoopContext({
      agentId: config.agentId,
      agentType: config.agentType,
      agentVersion: config.agentVersion,
      registry: config.registry,
      journal: config.journal,
      compactPolicy: config.compactPolicy,
    });
  }

  /**
   * 运行一轮对话：追加用户消息 → 循环调 provider，处理 tool_call，直至 stop / length / maxTurns
   * @param input 用户消息文本
   * @param runConfig 单次运行配置
   * @param onEvent 事件回调（delta / tool-call / tool-result / compacted）
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
