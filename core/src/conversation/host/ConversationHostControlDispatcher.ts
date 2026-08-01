/**
 * Narrow Host-control boundary for Stop, ReloadConfig, and future Host routes.
 *
 * Implementations receive Runtime dispatch capability only when one instance is
 * online; they never receive the placement-owned Runtime Handle.
 */
import type { AcceptedConversationInputSignal } from "../command/index.js";
import type { RuntimePresence } from "../RuntimePresence.js";
import type { ConversationRuntimeInputReference } from "./ConversationRuntimeInputReference.js";

export interface ConversationRuntimeCommandTarget {
  readonly conversationId: string;
  readonly runtimeInstanceId: string;

  dispatchInput(input: ConversationRuntimeInputReference): Promise<void>;
}

export interface ConversationHostControlDispatchContext {
  readonly presence: RuntimePresence;
  readonly runtime?: ConversationRuntimeCommandTarget;
}

export interface ConversationHostControlDispatcher {
  dispatch(
    signal: AcceptedConversationInputSignal,
    context: ConversationHostControlDispatchContext,
  ): Promise<void>;
}
