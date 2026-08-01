/** Runtime shutdown requests shared by Host and placement-neutral handles. */
import type { RuntimePresence } from "../RuntimePresence.js";

export const CONVERSATION_RUNTIME_SHUTDOWN_REASON = {
  explicitShutdown: "explicit_shutdown",
  hostClose: "host_close",
  idleEviction: "idle_eviction",
  replacement: "replacement",
} as const;

export type ConversationRuntimeShutdownReason =
  (typeof CONVERSATION_RUNTIME_SHUTDOWN_REASON)[keyof typeof CONVERSATION_RUNTIME_SHUTDOWN_REASON];

export interface ConversationRuntimeShutdownRequest {
  readonly conversationId: string;
  readonly reason: ConversationRuntimeShutdownReason;
}

export interface ConversationRuntimeHandleShutdownRequest {
  readonly reason: ConversationRuntimeShutdownReason;
}

export const CONVERSATION_RUNTIME_SHUTDOWN_STATUS = {
  stopped: "stopped",
  alreadyOffline: "already_offline",
} as const;

export type ConversationRuntimeShutdownStatus =
  (typeof CONVERSATION_RUNTIME_SHUTDOWN_STATUS)[keyof typeof CONVERSATION_RUNTIME_SHUTDOWN_STATUS];

export interface ConversationRuntimeShutdownResult {
  readonly status: ConversationRuntimeShutdownStatus;
  readonly presence: RuntimePresence;
}
