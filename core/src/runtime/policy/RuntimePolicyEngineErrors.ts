/** Stable Runtime Policy Engine failures without Policy data or raw causes. */
export const RUNTIME_POLICY_ENGINE_FAILURE = {
  invalidPolicy: "invalid_policy",
  duplicatePolicy: "duplicate_policy",
  invalidEvaluation: "invalid_evaluation",
  policyFailed: "policy_failed",
  invalidEffect: "invalid_effect",
} as const;

export type RuntimePolicyEngineFailure =
  (typeof RUNTIME_POLICY_ENGINE_FAILURE)[keyof typeof RUNTIME_POLICY_ENGINE_FAILURE];

export class RuntimePolicyEngineError extends Error {
  override readonly name = "RuntimePolicyEngineError";
  readonly code = "RUNTIME_POLICY_ENGINE_FAILED" as const;

  constructor(
    public readonly failure: RuntimePolicyEngineFailure,
    public readonly policyId?: string,
    public readonly conversationId?: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Runtime Policy Engine operation failed");
  }
}
