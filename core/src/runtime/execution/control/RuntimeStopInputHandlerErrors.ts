/** Stable Stop coordination failures without cancellation or Input content. */
export const RUNTIME_STOP_INPUT_FAILURE = {
  invalidInput: "invalid_input",
  fenceFailed: "fence_failed",
  lifecycleInvalid: "lifecycle_invalid",
  turnStoppingFailed: "turn_stopping_failed",
  runStoppingFailed: "run_stopping_failed",
  cancellationFailed: "cancellation_failed",
  turnCancelledFailed: "turn_cancelled_failed",
  runCancelledFailed: "run_cancelled_failed",
  queuedOutcomeFailed: "queued_outcome_failed",
  stopOutcomeFailed: "stop_outcome_failed",
} as const;

export type RuntimeStopInputFailure =
  (typeof RUNTIME_STOP_INPUT_FAILURE)[keyof typeof RUNTIME_STOP_INPUT_FAILURE];

export class RuntimeStopInputHandlerError extends Error {
  override readonly name = "RuntimeStopInputHandlerError";
  readonly code = "RUNTIME_STOP_INPUT_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly failure: RuntimeStopInputFailure,
  ) {
    super(`Runtime Stop Input processing failed: ${failure}`);
  }
}
