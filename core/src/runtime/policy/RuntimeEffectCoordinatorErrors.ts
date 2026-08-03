/** Stable Effect coordination failures without Effect payloads or raw causes. */
export const RUNTIME_EFFECT_COORDINATOR_FAILURE = {
  invalidRequest: "invalid_request",
  nudgeHandlerMissing: "nudge_handler_missing",
  nudgeLifecycleHandlerMissing: "nudge_lifecycle_handler_missing",
  compactionHandlerMissing: "compaction_handler_missing",
  nudgeFailed: "nudge_failed",
  nudgeLifecycleFailed: "nudge_lifecycle_failed",
  compactionFailed: "compaction_failed",
} as const;

export type RuntimeEffectCoordinatorFailure =
  (typeof RUNTIME_EFFECT_COORDINATOR_FAILURE)[keyof typeof RUNTIME_EFFECT_COORDINATOR_FAILURE];

export class RuntimeEffectCoordinatorError extends Error {
  override readonly name = "RuntimeEffectCoordinatorError";
  readonly code = "RUNTIME_EFFECT_COORDINATION_FAILED" as const;

  constructor(
    public readonly failure: RuntimeEffectCoordinatorFailure,
    public readonly conversationId: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
    public readonly policyId?: string,
    public readonly effectKind?:
      | "nudge"
      | "context_compaction"
      | "nudge_schedule"
      | "nudge_acknowledge"
      | "nudge_resolve"
      | "nudge_expire"
      | "nudge_supersede",
  ) {
    super("Runtime Effect coordination failed");
  }
}
