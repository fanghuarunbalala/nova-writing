/** Stable Nudge Manager failures without Reminder, parameters, or raw causes. */
export const NUDGE_MANAGER_FAILURE = {
  invalidSchedule: "invalid_schedule",
  scheduleFailed: "schedule_failed",
  selectionFailed: "selection_failed",
  leaseFailed: "lease_failed",
  renderFailed: "render_failed",
  confirmationFailed: "confirmation_failed",
  releaseFailed: "release_failed",
  expiryFailed: "expiry_failed",
  snapshotFailed: "snapshot_failed",
  restoreFailed: "restore_failed",
} as const;

export type NudgeManagerFailure =
  (typeof NUDGE_MANAGER_FAILURE)[keyof typeof NUDGE_MANAGER_FAILURE];

export class NudgeManagerError extends Error {
  override readonly name = "NudgeManagerError";
  readonly code = "NUDGE_MANAGER_FAILED" as const;

  constructor(
    public readonly failure: NudgeManagerFailure,
    public readonly nudgeId?: string,
    public readonly targetRunId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Nudge Manager operation failed");
  }
}
