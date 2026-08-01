/** Factory boundary that assembles an immutable Runtime bootstrap snapshot. */
import type { ConversationRuntimeActivationCause } from "./ConversationRuntimeActivation.js";
import type { ConversationRuntimeBootstrap } from "./ConversationRuntimeBootstrap.js";

export interface ConversationRuntimeBootstrapRequest {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
  readonly activatedAt: string;
  readonly activation: ConversationRuntimeActivationCause;
}

export interface ConversationRuntimeBootstrapFactory {
  create(
    request: ConversationRuntimeBootstrapRequest,
  ): Promise<ConversationRuntimeBootstrap>;
}
