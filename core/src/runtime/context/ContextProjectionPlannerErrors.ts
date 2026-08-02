/** Stable Projection failures without Checkpoint, Message, or Prompt content. */
export const CONTEXT_PROJECTION_PLANNER_FAILURE = {
  invalidCandidate: "invalid_candidate",
  contextUnreducible: "context_unreducible",
  candidateLoadFailed: "candidate_load_failed",
  overlayRenderFailed: "overlay_render_failed",
  applicationFailed: "application_failed",
} as const;

export type ContextProjectionPlannerFailure =
  (typeof CONTEXT_PROJECTION_PLANNER_FAILURE)[keyof typeof CONTEXT_PROJECTION_PLANNER_FAILURE];

export class ContextProjectionPlannerError extends Error {
  override readonly name = "ContextProjectionPlannerError";
  readonly code = "CONTEXT_PROJECTION_PLANNING_FAILED" as const;

  constructor(
    public readonly failure: ContextProjectionPlannerFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
    public readonly checkpointId?: string,
  ) {
    super("Context Projection planning failed");
  }
}
