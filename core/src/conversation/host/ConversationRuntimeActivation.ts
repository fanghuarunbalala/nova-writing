/** Runtime activation request and result protocol used by ConversationHost. */
import type { RuntimePresence } from "../RuntimePresence.js";
import type { ConversationRuntimeInputReference } from "./ConversationRuntimeInputReference.js";

export const CONVERSATION_RUNTIME_ACTIVATION_REASON = {
  acceptedInput: "accepted_input",
  explicitRestore: "explicit_restore",
  crashRecovery: "crash_recovery",
} as const;

export type ConversationRuntimeActivationReason =
  (typeof CONVERSATION_RUNTIME_ACTIVATION_REASON)[keyof typeof CONVERSATION_RUNTIME_ACTIVATION_REASON];

export type ConversationRuntimeActivationCause =
  | Readonly<{
      reason: typeof CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput;
      input: ConversationRuntimeInputReference;
    }>
  | Readonly<{
      reason:
        | typeof CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore
        | typeof CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery;
    }>;

export type ConversationRuntimeActivationRequest = Readonly<{
  conversationId: string;
}> &
  ConversationRuntimeActivationCause;

export const CONVERSATION_RUNTIME_ACTIVATION_STATUS = {
  activated: "activated",
  reused: "reused",
} as const;

export type ConversationRuntimeActivationStatus =
  (typeof CONVERSATION_RUNTIME_ACTIVATION_STATUS)[keyof typeof CONVERSATION_RUNTIME_ACTIVATION_STATUS];

export interface ConversationRuntimeActivationResult {
  readonly status: ConversationRuntimeActivationStatus;
  readonly presence: RuntimePresence;
}
