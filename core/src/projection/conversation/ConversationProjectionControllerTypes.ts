/** Immutable lifecycle state for one Conversation-to-Projection connection. */
import type { RuntimePresence } from "../../conversation/RuntimePresence.js";

export const CONVERSATION_PROJECTION_CONTROLLER_STATE = {
  idle: "idle",
  starting: "starting",
  replaying: "replaying",
  following: "following",
  live: "live",
  disconnected: "disconnected",
  failed: "failed",
  stopping: "stopping",
  stopped: "stopped",
} as const;

export type ConversationProjectionControllerState =
  (typeof CONVERSATION_PROJECTION_CONTROLLER_STATE)[keyof typeof CONVERSATION_PROJECTION_CONTROLLER_STATE];

export interface ConversationProjectionControllerErrorSnapshot {
  readonly code: string;
  readonly retryable: boolean;
  readonly category: "transport" | "remote" | "projection" | "unknown";
}

export interface ConversationProjectionControllerSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly state: ConversationProjectionControllerState;
  readonly lastAppliedSequence: number;
  readonly runtimePresence?: RuntimePresence;
  readonly error?: ConversationProjectionControllerErrorSnapshot;
}

export type ConversationProjectionControllerListener = () => void;
