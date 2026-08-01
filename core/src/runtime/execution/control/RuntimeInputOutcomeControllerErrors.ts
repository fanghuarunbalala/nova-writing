/** Stable Input outcome coordination errors without payloads or raw causes. */
export class RuntimeInputOutcomeControllerStateError extends Error {
  readonly code = "RUNTIME_INPUT_OUTCOME_STATE_INVALID";

  constructor(public readonly reason: string) {
    super(`Runtime Input outcome state is invalid: ${reason}`);
    this.name = "RuntimeInputOutcomeControllerStateError";
  }
}

export class RuntimeInputOutcomePendingCommitError extends Error {
  readonly code = "RUNTIME_INPUT_OUTCOME_PENDING_COMMIT";

  constructor() {
    super("Runtime Input outcome has a pending durable commit");
    this.name = "RuntimeInputOutcomePendingCommitError";
  }
}

export class RuntimeInputOutcomeConflictError extends Error {
  readonly code = "RUNTIME_INPUT_OUTCOME_CONFLICT";

  constructor(public readonly inputEventId: string) {
    super("Runtime Input already has a conflicting terminal outcome");
    this.name = "RuntimeInputOutcomeConflictError";
  }
}
