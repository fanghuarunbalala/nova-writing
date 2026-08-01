/** Process-local lifecycle states owned by one ConversationRuntime instance. */
export const CONVERSATION_RUNTIME_STATE = {
  created: "created",
  starting: "starting",
  online: "online",
  stopping: "stopping",
  stopped: "stopped",
  crashed: "crashed",
} as const;

export type ConversationRuntimeState =
  (typeof CONVERSATION_RUNTIME_STATE)[keyof typeof CONVERSATION_RUNTIME_STATE];
