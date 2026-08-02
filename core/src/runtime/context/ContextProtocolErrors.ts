/** Stable Context protocol validation failures without prompts or Message data. */
export const CONTEXT_PROTOCOL_VALIDATION_FAILURE = {
  invalidBudgetThresholds: "invalid_budget_thresholds",
  invalidEffectiveBudget: "invalid_effective_budget",
  invalidInputEstimate: "invalid_input_estimate",
  invalidIrreducibleFloor: "invalid_irreducible_floor",
  invalidPressureSnapshot: "invalid_pressure_snapshot",
  invalidPinnedGroup: "invalid_pinned_group",
  invalidCheckpointItem: "invalid_checkpoint_item",
  invalidCheckpoint: "invalid_checkpoint",
  invalidProjection: "invalid_projection",
  invalidAttemptIdentity: "invalid_attempt_identity",
  invalidAssessment: "invalid_assessment",
} as const;

export type ContextProtocolValidationFailure =
  (typeof CONTEXT_PROTOCOL_VALIDATION_FAILURE)[keyof typeof CONTEXT_PROTOCOL_VALIDATION_FAILURE];

export class ContextProtocolValidationError extends Error {
  override readonly name = "ContextProtocolValidationError";
  readonly code = "CONTEXT_PROTOCOL_VALIDATION_FAILED" as const;

  constructor(
    public readonly failure: ContextProtocolValidationFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
    public readonly checkpointId?: string,
  ) {
    super("Context protocol validation failed");
  }
}
