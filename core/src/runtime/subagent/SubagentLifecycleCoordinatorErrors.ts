/** Stable lifecycle coordination failures without child content or raw causes. */
export const SUBAGENT_LIFECYCLE_FAILURE = Object.freeze({
  startFailed: "start_failed",
  startedProjectionFailed: "started_projection_failed",
  unknownSubagent: "unknown_subagent",
  invalidProgress: "invalid_progress",
  childNotRunning: "child_not_running",
  progressProjectionFailed: "progress_projection_failed",
  invalidResult: "invalid_result",
  terminalProjectionFailed: "terminal_projection_failed",
  terminalTransitionFailed: "terminal_transition_failed",
  duplicateResultConflict: "duplicate_result_conflict",
} as const);

export type SubagentLifecycleFailure =
  (typeof SUBAGENT_LIFECYCLE_FAILURE)[keyof typeof SUBAGENT_LIFECYCLE_FAILURE];

export class SubagentLifecycleCoordinatorError extends Error {
  override readonly name = "SubagentLifecycleCoordinatorError";
  readonly code = "SUBAGENT_LIFECYCLE_COORDINATION_FAILED" as const;

  constructor(
    readonly failure: SubagentLifecycleFailure,
    readonly subagentId?: string,
    readonly parentConversationId?: string,
    readonly parentRunId?: string,
    readonly childConversationId?: string,
  ) {
    super("Subagent lifecycle coordination failed");
  }
}
