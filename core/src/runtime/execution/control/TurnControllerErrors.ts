/** Stable TurnController coordination errors without Event payloads or raw causes. */
export class TurnControllerStateError extends Error {
  readonly code = "TURN_CONTROLLER_STATE_INVALID";

  constructor(public readonly reason: string) {
    super(`TurnController state is invalid: ${reason}`);
    this.name = "TurnControllerStateError";
  }
}

export class TurnControllerPendingCommitError extends Error {
  readonly code = "TURN_CONTROLLER_PENDING_COMMIT";

  constructor() {
    super("TurnController has a pending durable commit");
    this.name = "TurnControllerPendingCommitError";
  }
}
