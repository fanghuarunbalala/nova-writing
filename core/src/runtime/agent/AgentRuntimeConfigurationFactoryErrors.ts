/** Stable failures for manifest-bound Agent Runtime configuration restoration. */
export const AGENT_RUNTIME_BOOTSTRAP_FAILURE = {
  manifestBindingMissing: "manifest_binding_missing",
  manifestMissing: "manifest_missing",
  manifestMismatch: "manifest_mismatch",
  profileMissing: "profile_missing",
} as const;

export type AgentRuntimeBootstrapFailure =
  (typeof AGENT_RUNTIME_BOOTSTRAP_FAILURE)[keyof typeof AGENT_RUNTIME_BOOTSTRAP_FAILURE];

export class AgentRuntimeBootstrapError extends Error {
  override readonly name = "AgentRuntimeBootstrapError";
  readonly code = "AGENT_RUNTIME_BOOTSTRAP_FAILED" as const;

  constructor(readonly failure: AgentRuntimeBootstrapFailure) {
    super(`Agent Runtime Bootstrap failed (${failure})`);
  }
}
