/** Stable Nudge protocol validation failures without Reminder or parameter data. */
export const NUDGE_PROTOCOL_VALIDATION_FAILURE = {
  invalidEffect: "invalid_effect",
  invalidPendingNudge: "invalid_pending_nudge",
  invalidLeaseRequest: "invalid_lease_request",
  invalidLease: "invalid_lease",
  invalidOverlay: "invalid_overlay",
} as const;

export type NudgeProtocolValidationFailure =
  (typeof NUDGE_PROTOCOL_VALIDATION_FAILURE)[keyof typeof NUDGE_PROTOCOL_VALIDATION_FAILURE];

export class NudgeProtocolValidationError extends Error {
  override readonly name = "NudgeProtocolValidationError";
  readonly code = "NUDGE_PROTOCOL_VALIDATION_FAILED" as const;

  constructor(
    public readonly failure: NudgeProtocolValidationFailure,
    public readonly nudgeId?: string,
    public readonly targetRunId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Nudge protocol validation failed");
  }
}
