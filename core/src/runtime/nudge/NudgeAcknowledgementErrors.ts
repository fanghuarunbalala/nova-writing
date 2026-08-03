/** Stable acknowledgement failures without free-form reasons or source data. */
export const NUDGE_ACKNOWLEDGEMENT_FAILURE = {
  invalidRequest: "invalid_request",
  unsupportedSource: "unsupported_source",
  storeFailed: "store_failed",
} as const;

export type NudgeAcknowledgementFailure =
  (typeof NUDGE_ACKNOWLEDGEMENT_FAILURE)[keyof typeof NUDGE_ACKNOWLEDGEMENT_FAILURE];

export class NudgeAcknowledgementError extends Error {
  override readonly name = "NudgeAcknowledgementError";
  readonly code = "NUDGE_ACKNOWLEDGEMENT_FAILED" as const;

  constructor(
    public readonly failure: NudgeAcknowledgementFailure,
    public readonly nudgeId?: string,
    public readonly targetRunId?: string,
  ) {
    super("Nudge acknowledgement failed");
  }
}
