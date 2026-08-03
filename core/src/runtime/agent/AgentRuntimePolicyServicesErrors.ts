/** Stable failures for Runtime Policy/Context/Nudge service resolution. */
export const AGENT_RUNTIME_POLICY_SERVICES_FAILURE = {
  profileMissing: "profile_missing",
} as const;

export type AgentRuntimePolicyServicesFailure =
  (typeof AGENT_RUNTIME_POLICY_SERVICES_FAILURE)[keyof typeof AGENT_RUNTIME_POLICY_SERVICES_FAILURE];

export class AgentRuntimePolicyServicesError extends Error {
  override readonly name = "AgentRuntimePolicyServicesError";
  readonly code = "AGENT_RUNTIME_POLICY_SERVICES_FAILED" as const;

  constructor(readonly failure: AgentRuntimePolicyServicesFailure) {
    super(`Agent Runtime policy services failed (${failure})`);
  }
}
