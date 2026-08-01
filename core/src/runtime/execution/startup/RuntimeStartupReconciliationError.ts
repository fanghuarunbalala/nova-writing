/** Stable startup-plan rejection without Event payloads or raw causes. */
export const RUNTIME_STARTUP_RECONCILIATION_FAILURE = {
  invalidPlan: "invalid_plan",
  claimMismatch: "claim_mismatch",
  lifecycleConflict: "lifecycle_conflict",
} as const;

export type RuntimeStartupReconciliationFailure =
  (typeof RUNTIME_STARTUP_RECONCILIATION_FAILURE)[keyof typeof RUNTIME_STARTUP_RECONCILIATION_FAILURE];

export class RuntimeStartupReconciliationError extends Error {
  readonly code = "RUNTIME_STARTUP_RECONCILIATION_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly throughSequence: number,
    public readonly failure: RuntimeStartupReconciliationFailure,
  ) {
    super(`Runtime startup reconciliation failed: ${failure}`);
    this.name = "RuntimeStartupReconciliationError";
  }
}
