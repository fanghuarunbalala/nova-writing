/** Stable Pending Nudge Store failures without Reminder or parameter data. */
export const PENDING_NUDGE_STORE_FAILURE = {
  invalidNudge: "invalid_nudge",
  nudgeConflict: "nudge_conflict",
  invalidLease: "invalid_lease",
  leaseConflict: "lease_conflict",
  leaseNotFound: "lease_not_found",
  invalidConfirmation: "invalid_confirmation",
  invalidAcknowledgement: "invalid_acknowledgement",
  invalidConditionResolution: "invalid_condition_resolution",
  invalidSupersession: "invalid_supersession",
  invalidRelease: "invalid_release",
  invalidExpiry: "invalid_expiry",
  invalidSnapshot: "invalid_snapshot",
} as const;

export type PendingNudgeStoreFailure =
  (typeof PENDING_NUDGE_STORE_FAILURE)[keyof typeof PENDING_NUDGE_STORE_FAILURE];

export class PendingNudgeStoreError extends Error {
  override readonly name = "PendingNudgeStoreError";
  readonly code = "PENDING_NUDGE_STORE_FAILED" as const;

  constructor(
    public readonly failure: PendingNudgeStoreFailure,
    public readonly nudgeId?: string,
    public readonly targetRunId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Pending Nudge Store operation failed");
  }
}
