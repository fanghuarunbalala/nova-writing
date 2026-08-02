/** Stable Runtime Policy protocol failures without Context or Message content. */
export const RUNTIME_POLICY_PROTOCOL_FAILURE = {
  invalidContext: "invalid_context",
  invalidState: "invalid_state",
  invalidEffect: "invalid_effect",
} as const;

export type RuntimePolicyProtocolFailure =
  (typeof RUNTIME_POLICY_PROTOCOL_FAILURE)[keyof typeof RUNTIME_POLICY_PROTOCOL_FAILURE];

export class RuntimePolicyProtocolError extends Error {
  override readonly name = "RuntimePolicyProtocolError";
  readonly code = "RUNTIME_POLICY_PROTOCOL_INVALID" as const;

  constructor(
    public readonly failure: RuntimePolicyProtocolFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Runtime Policy protocol value is invalid");
  }
}
