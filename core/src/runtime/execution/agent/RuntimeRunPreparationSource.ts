/**
 * 为一次已认领的 Run 提供完整、provider-neutral 的 Agent 调用准备。
 * Supplies one fully selected, provider-neutral Agent invocation for a claimed Run.
 */
import type { AgentRuntimeInvocation } from "../../agent/index.js";
import type { PromptBase } from "../../../prompt/index.js";
import type { RuntimeMessageSnapshot } from "../../message/index.js";
import type { RuntimeRunExecutionRequest } from "../control/RuntimeUserMessageInputHandler.js";

export interface RuntimeRunPreparation {
  readonly conversationId: string;
  readonly runId: string;
  /** 编译后的 base prompt（content + digest，动态内容以 system.reminder 消息进入 messages）。Compiled base prompt (content + digest); dynamic content arrives via system.reminder messages. */
  readonly basePrompt: PromptBase;
  /** 消息投影高水位（组装 digest 输入之一）。Message-projection high watermark (assembly digest input). */
  readonly messageHighWatermark: number;
  /** 显式调用前的 canonical 消息序列。Canonical transcript before the explicit invocation. */
  readonly contextMessages: readonly RuntimeMessageSnapshot[];
  readonly invocation: AgentRuntimeInvocation;
}

export interface RuntimeRunPreparationSource {
  prepare(request: RuntimeRunExecutionRequest): Promise<RuntimeRunPreparation>;
}
