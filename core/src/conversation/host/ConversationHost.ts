/**
 * Placement-neutral lifecycle authority for Conversation Runtime instances.
 *
 * Accepted-input notification schedules Host work only; it does not imply
 * Runtime activation, dispatch, Run creation, or Agent completion.
 */
import type { AcceptedConversationInputNotifier } from "../command/index.js";
import type { ConversationRuntimePresenceReader } from "../ConversationRuntimePresenceReader.js";
import type {
  ConversationRuntimeActivationRequest,
  ConversationRuntimeActivationResult,
} from "./ConversationRuntimeActivation.js";
import type {
  ConversationRuntimeShutdownRequest,
  ConversationRuntimeShutdownResult,
} from "./ConversationRuntimeShutdown.js";

export interface ConversationHost
  extends AcceptedConversationInputNotifier,
    ConversationRuntimePresenceReader {
  ensureActive(
    request: ConversationRuntimeActivationRequest,
  ): Promise<ConversationRuntimeActivationResult>;

  shutdownRuntime(
    request: ConversationRuntimeShutdownRequest,
  ): Promise<ConversationRuntimeShutdownResult>;

  close(): Promise<void>;
}
