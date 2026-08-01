/** Stable pure-state errors without Runtime payloads or adapter details. */
export type ExecutionStateScope = "run" | "turn";

export class ExecutionStateTransitionError extends Error {
  readonly code = "EXECUTION_STATE_TRANSITION_INVALID";

  constructor(
    public readonly scope: ExecutionStateScope,
    public readonly previous: string | null,
    public readonly current: string,
    public readonly reason: string,
  ) {
    super(`Invalid ${scope} state transition`);
    this.name = "ExecutionStateTransitionError";
  }
}

export class ExecutionStateRestoreError extends Error {
  readonly code = "EXECUTION_STATE_RESTORE_INVALID";

  constructor(public readonly scope: ExecutionStateScope) {
    super(`Invalid ${scope} state snapshot`);
    this.name = "ExecutionStateRestoreError";
  }
}
