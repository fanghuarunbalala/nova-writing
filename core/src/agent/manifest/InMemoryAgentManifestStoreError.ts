/** Stable Core error identity for conflicting immutable Manifest writes. */
export type AgentManifestStoreFailure = "manifest_conflict";

export class AgentManifestStoreError extends Error {
  override readonly name = "AgentManifestStoreError";

  constructor(readonly failure: AgentManifestStoreFailure) {
    super(`Agent Manifest Store failed (${failure})`);
  }
}
