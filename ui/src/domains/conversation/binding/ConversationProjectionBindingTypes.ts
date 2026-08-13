/** Immutable React-facing lifecycle around one Core Conversation projection. */
import type {
  ConversationProjectionControllerErrorSnapshot,
  ConversationProjectionControllerSnapshot,
  ConversationProjectionSnapshot,
} from "@novel/core";
import type { ConversationCardProjectionSnapshot } from "../cards/projection/index.js";

export const CONVERSATION_PROJECTION_BINDING_STATE = {
  idle: "idle",
  opening: "opening",
  active: "active",
  failed: "failed",
  stopping: "stopping",
  stopped: "stopped",
} as const;

export type ConversationProjectionBindingState =
  (typeof CONVERSATION_PROJECTION_BINDING_STATE)[keyof typeof CONVERSATION_PROJECTION_BINDING_STATE];

export interface ConversationProjectionBindingSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly state: ConversationProjectionBindingState;
  readonly projection: ConversationProjectionSnapshot;
  readonly cards: ConversationCardProjectionSnapshot;
  readonly controller?: ConversationProjectionControllerSnapshot;
  readonly error?: ConversationProjectionControllerErrorSnapshot;
}

export type ConversationProjectionBindingListener = () => void;
