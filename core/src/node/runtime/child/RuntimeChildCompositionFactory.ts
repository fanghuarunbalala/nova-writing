/** Child-local Runtime construction Port; Provider credentials stay behind it. */
import type {
  ConversationRuntimeBootstrap,
  ConversationRuntimeExit,
  ConversationRuntimeHandleShutdownRequest,
  ConversationRuntimeInputReference,
} from "../../../conversation/host/index.js";
import type { RuntimeBootstrapStartupResult } from "../../../runtime/execution/index.js";

export interface RuntimeChildRuntime {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;

  start(bootstrap: ConversationRuntimeBootstrap): Promise<RuntimeBootstrapStartupResult>;

  dispatchInput(input: ConversationRuntimeInputReference): Promise<void>;

  shutdown(request: ConversationRuntimeHandleShutdownRequest): Promise<void>;

  waitForExit(): Promise<ConversationRuntimeExit>;
}

export interface RuntimeChildCompositionFactory {
  create(bootstrap: ConversationRuntimeBootstrap): Promise<RuntimeChildRuntime>;
}
