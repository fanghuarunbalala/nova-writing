/** Stable Pi Turn lifecycle bridge failures without Agent event contents. */
export const PI_TURN_LIFECYCLE_BRIDGE_FAILURE = {
  invalidRequest: "invalid_request",
  runMismatch: "run_mismatch",
  runNotRunning: "run_not_running",
  turnMissing: "turn_missing",
  turnMismatch: "turn_mismatch",
  turnAlreadyTerminal: "turn_already_terminal",
  cancellationState: "cancellation_state",
  agentEndWithActiveTurn: "agent_end_with_active_turn",
  lifecycleCommit: "lifecycle_commit",
} as const;

export type PiTurnLifecycleBridgeFailure =
  (typeof PI_TURN_LIFECYCLE_BRIDGE_FAILURE)[keyof typeof PI_TURN_LIFECYCLE_BRIDGE_FAILURE];

export class PiTurnLifecycleBridgeError extends Error {
  override readonly name = "PiTurnLifecycleBridgeError";
  readonly code = "PI_TURN_LIFECYCLE_BRIDGE_FAILED" as const;

  constructor(
    public readonly failure: PiTurnLifecycleBridgeFailure,
    public readonly conversationId: string,
    public readonly runId?: string,
    public readonly turnId?: string,
  ) {
    super("Pi Turn lifecycle bridge failed");
  }
}
