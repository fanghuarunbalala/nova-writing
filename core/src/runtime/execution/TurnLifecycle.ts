/** Stable provider-independent Turn states and transition reasons. */
export const TURN_STATUS = {
  running: "running",
  waitingTool: "waiting_tool",
  waitingInteraction: "waiting_interaction",
  stopping: "stopping",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type TurnStatus = (typeof TURN_STATUS)[keyof typeof TURN_STATUS];

export const TURN_STATE_CHANGE_REASON = {
  providerStarted: "provider_started",
  toolExecutionStarted: "tool_execution_started",
  toolExecutionCompleted: "tool_execution_completed",
  interactionRequested: "interaction_requested",
  interactionResolved: "interaction_resolved",
  stopRequested: "stop_requested",
  interruptRequested: "interrupt_requested",
  turnCompleted: "turn_completed",
  turnFailed: "turn_failed",
  cancellationCompleted: "cancellation_completed",
  recoveryRestored: "recovery_restored",
} as const;

export type TurnStateChangeReason =
  (typeof TURN_STATE_CHANGE_REASON)[keyof typeof TURN_STATE_CHANGE_REASON];

export function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === "string" && Object.values(TURN_STATUS).includes(value as TurnStatus);
}

export function isTurnStateChangeReason(value: unknown): value is TurnStateChangeReason {
  return (
    typeof value === "string" &&
    Object.values(TURN_STATE_CHANGE_REASON).includes(value as TurnStateChangeReason)
  );
}
