/** Stable Effect coordination failures without Effect payloads or raw causes. */
export const RUNTIME_EFFECT_COORDINATOR_FAILURE = {
  invalidRequest: "invalid_request",
  systemReminderAttachHandlerMissing: "system_reminder_attach_handler_missing",
  compactionHandlerMissing: "compaction_handler_missing",
  systemReminderAttachFailed: "system_reminder_attach_failed",
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
    public readonly effectKind?: "system_reminder_attach" | "context_compaction",
  ) {
    super("Runtime Effect coordination failed");
  }
}
