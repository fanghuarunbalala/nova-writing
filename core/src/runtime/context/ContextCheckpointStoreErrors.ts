/** Stable Checkpoint Store failures without summaries, Messages, or raw causes. */
export const CONTEXT_CHECKPOINT_STORE_FAILURE = {
  invalidConversation: "invalid_conversation",
  invalidReservation: "invalid_reservation",
  invalidFinalization: "invalid_finalization",
  invalidFailure: "invalid_failure",
  attemptNotReserved: "attempt_not_reserved",
  attemptConflict: "attempt_conflict",
  activationConflict: "activation_conflict",
  checkpointConflict: "checkpoint_conflict",
} as const;

export type ContextCheckpointStoreFailure =
  (typeof CONTEXT_CHECKPOINT_STORE_FAILURE)[keyof typeof CONTEXT_CHECKPOINT_STORE_FAILURE];

export class ContextCheckpointStoreError extends Error {
  override readonly name = "ContextCheckpointStoreError";
  readonly code = "CONTEXT_CHECKPOINT_STORE_FAILED" as const;

  constructor(
    public readonly failure: ContextCheckpointStoreFailure,
    public readonly conversationId?: string,
    public readonly checkpointId?: string,
  ) {
    super("Context Checkpoint Store operation failed");
  }
}
