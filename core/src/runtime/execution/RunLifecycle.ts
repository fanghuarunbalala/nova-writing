/** Stable provider-independent Run states and transition reasons. */
export const RUN_STATUS = {
  queued: "queued",
  running: "running",
  waitingInteraction: "waiting_interaction",
  stopping: "stopping",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export const RUN_STATE_CHANGE_REASON = {
  inputQueued: "input_queued",
  executionStarted: "execution_started",
  interactionRequested: "interaction_requested",
  interactionResolved: "interaction_resolved",
  stopRequested: "stop_requested",
  interruptRequested: "interrupt_requested",
  executionCompleted: "execution_completed",
  executionFailed: "execution_failed",
  cancellationCompleted: "cancellation_completed",
  recoveryRestored: "recovery_restored",
} as const;

export type RunStateChangeReason =
  (typeof RUN_STATE_CHANGE_REASON)[keyof typeof RUN_STATE_CHANGE_REASON];

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && Object.values(RUN_STATUS).includes(value as RunStatus);
}

export function isRunStateChangeReason(value: unknown): value is RunStateChangeReason {
  return (
    typeof value === "string" &&
    Object.values(RUN_STATE_CHANGE_REASON).includes(value as RunStateChangeReason)
  );
}
