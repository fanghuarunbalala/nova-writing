/** Stable Nudge lifecycle failures without Reminder or parameter data. */
export const NUDGE_STATE_MACHINE_FAILURE = {
  invalidNudge: "invalid_nudge",
  invalidAction: "invalid_action",
  illegalTransition: "illegal_transition",
} as const;

export type NudgeStateMachineFailure =
  (typeof NUDGE_STATE_MACHINE_FAILURE)[keyof typeof NUDGE_STATE_MACHINE_FAILURE];

export class NudgeStateMachineError extends Error {
  override readonly name = "NudgeStateMachineError";
  readonly code = "NUDGE_STATE_MACHINE_FAILED" as const;

  constructor(
    public readonly failure: NudgeStateMachineFailure,
    public readonly nudgeId?: string,
    public readonly state?: string,
    public readonly action?: string,
  ) {
    super("Nudge state transition failed");
  }
}
