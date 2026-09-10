/** Immutable React-facing lifecycle around one Core Conversation projection. */
import type { ConversationProjectionSnapshot } from "@novel/core/client";

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
  readonly state: ConversationProjectionBindingState;
  /** 精简投影快照（timeline / lastAppliedSequence / 状态 / error）。 */
  readonly projection: ConversationProjectionSnapshot;
}

export type ConversationProjectionBindingListener = () => void;
