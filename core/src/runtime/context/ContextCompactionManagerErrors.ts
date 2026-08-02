/** Stable Compaction Manager failures without source, summary, or raw causes. */
export const CONTEXT_COMPACTION_MANAGER_FAILURE = {
  invalidEffect: "invalid_effect",
  activeCheckpointFailed: "active_checkpoint_failed",
  sourceFailed: "source_failed",
  sourceInvalid: "source_invalid",
  sourceDigestFailed: "source_digest_failed",
  attemptReservationFailed: "attempt_reservation_failed",
  compactorFailed: "compactor_failed",
  resultInvalid: "result_invalid",
  checkpointIdFailed: "checkpoint_id_failed",
  clockFailed: "clock_failed",
  checkpointDigestFailed: "checkpoint_digest_failed",
  checkpointInvalid: "checkpoint_invalid",
  semanticValidationFailed: "semantic_validation_failed",
  attemptFinalizationFailed: "attempt_finalization_failed",
} as const;

export type ContextCompactionManagerFailure =
  (typeof CONTEXT_COMPACTION_MANAGER_FAILURE)[keyof typeof CONTEXT_COMPACTION_MANAGER_FAILURE];

export class ContextCompactionManagerError extends Error {
  override readonly name = "ContextCompactionManagerError";
  readonly code = "CONTEXT_COMPACTION_MANAGER_FAILED" as const;

  constructor(
    public readonly failure: ContextCompactionManagerFailure,
    public readonly conversationId: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Context Compaction Manager operation failed");
  }
}
