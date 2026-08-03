/** Stable condition failures without evaluator causes or condition payloads. */
export const NUDGE_CONDITION_FAILURE = {
  invalidRequest: "invalid_request",
  evaluationFailed: "evaluation_failed",
  evaluationTimeout: "evaluation_timeout",
  storeFailed: "store_failed",
} as const;

export type NudgeConditionFailure =
  (typeof NUDGE_CONDITION_FAILURE)[keyof typeof NUDGE_CONDITION_FAILURE];

export class NudgeConditionError extends Error {
  override readonly name = "NudgeConditionError";
  readonly code = "NUDGE_CONDITION_FAILED" as const;

  constructor(
    public readonly failure: NudgeConditionFailure,
    public readonly nudgeId?: string,
    public readonly targetRunId?: string,
  ) {
    super("Nudge condition evaluation failed");
  }
}
