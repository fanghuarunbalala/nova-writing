/** Stable failures for the Runtime Tool approval decision control handler. */
export const RUNTIME_APPROVAL_DECISION_FAILURE = {
  unexpectedEventType: "unexpected_event_type",
  resolutionFailed: "resolution_failed",
} as const;

export type RuntimeApprovalDecisionFailure =
  (typeof RUNTIME_APPROVAL_DECISION_FAILURE)[keyof typeof RUNTIME_APPROVAL_DECISION_FAILURE];

export class RuntimeApprovalDecisionInputError extends Error {
  override readonly name = "RuntimeApprovalDecisionInputError";
  readonly code = "RUNTIME_APPROVAL_DECISION_FAILED" as const;

  constructor(
    readonly failure: RuntimeApprovalDecisionFailure,
    readonly conversationId: string,
  ) {
    super(`Runtime Tool approval decision failed (${failure})`);
  }
}
