/** Stable replay-planning failure without Journal payloads or raw errors. */
export const RUNTIME_REPLAY_PLANNING_FAILURE = {
  invalidRequest: "invalid_request",
  readFailed: "read_failed",
  watermarkMismatch: "watermark_mismatch",
  journalGap: "journal_gap",
  invalidEvent: "invalid_event",
  historyConflict: "history_conflict",
} as const;

export type RuntimeReplayPlanningFailure =
  (typeof RUNTIME_REPLAY_PLANNING_FAILURE)[keyof typeof RUNTIME_REPLAY_PLANNING_FAILURE];

export class RuntimeReplayPlanningError extends Error {
  readonly code = "RUNTIME_REPLAY_PLANNING_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly throughSequence: number,
    public readonly sequence: number,
    public readonly failure: RuntimeReplayPlanningFailure,
  ) {
    super(`Runtime replay planning failed: ${failure}`);
    this.name = "RuntimeReplayPlanningError";
  }
}
