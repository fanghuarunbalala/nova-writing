/** Stable ready-plan execution failure without payloads or raw causes. */
export const RUNTIME_STARTUP_EXECUTION_FAILURE = {
  invalidPlan: "invalid_plan",
  recoveryRequired: "recovery_required",
  alreadyStarted: "already_started",
  noResumableExecution: "no_resumable_execution",
  outcomePending: "outcome_pending",
  outcomeFailed: "outcome_failed",
  restoreFailed: "restore_failed",
  routeBlocked: "route_blocked",
  routeFailed: "route_failed",
} as const;

export type RuntimeStartupExecutionFailure =
  (typeof RUNTIME_STARTUP_EXECUTION_FAILURE)[keyof typeof RUNTIME_STARTUP_EXECUTION_FAILURE];

export class RuntimeStartupExecutionError extends Error {
  readonly code = "RUNTIME_STARTUP_EXECUTION_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly throughSequence: number,
    public readonly failure: RuntimeStartupExecutionFailure,
  ) {
    super(`Runtime startup execution failed: ${failure}`);
    this.name = "RuntimeStartupExecutionError";
  }
}
