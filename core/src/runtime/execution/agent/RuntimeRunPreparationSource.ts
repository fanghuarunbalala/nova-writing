/** Supplies one fully selected, provider-neutral Agent invocation for a claimed Run. */
import type { AgentRuntimeInvocation } from "../../agent/index.js";
import type { RuntimeMessageSnapshot } from "../../message/index.js";
import type { RuntimeRunExecutionRequest } from "../control/RuntimeUserMessageInputHandler.js";

export interface RuntimeRunPreparation {
  readonly conversationId: string;
  readonly runId: string;
  /** Final base prompt; layer ordering is owned by the preparation source. */
  readonly systemPrompt: string;
  /** Canonical transcript before the explicit invocation. */
  readonly contextMessages: readonly RuntimeMessageSnapshot[];
  readonly invocation: AgentRuntimeInvocation;
}

export interface RuntimeRunPreparationSource {
  prepare(request: RuntimeRunExecutionRequest): Promise<RuntimeRunPreparation>;
}
