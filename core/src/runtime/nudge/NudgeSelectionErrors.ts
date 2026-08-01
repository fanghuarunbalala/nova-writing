/** Stable Nudge selection failures without Reminder or parameter data. */
export const NUDGE_SELECTION_FAILURE = {
  invalidRequest: "invalid_request",
  invalidCandidate: "invalid_candidate",
  invalidCooldown: "invalid_cooldown",
} as const;

export type NudgeSelectionFailure =
  (typeof NUDGE_SELECTION_FAILURE)[keyof typeof NUDGE_SELECTION_FAILURE];

export class NudgeSelectionError extends Error {
  override readonly name = "NudgeSelectionError";
  readonly code = "NUDGE_SELECTION_FAILED" as const;

  constructor(
    public readonly failure: NudgeSelectionFailure,
    public readonly targetRunId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Nudge selection failed");
  }
}
