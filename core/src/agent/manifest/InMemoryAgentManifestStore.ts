/** Deterministic in-memory Agent Manifest Store for Core tests and local assembly. */
import { AgentManifest } from "./AgentManifest.js";
import { AgentManifestStoreError } from "./InMemoryAgentManifestStoreError.js";
import type { AgentManifestStore } from "./AgentManifestStore.js";

export class InMemoryAgentManifestStore implements AgentManifestStore {
  readonly #manifests = new Map<string, AgentManifest>();

  async save(manifest: AgentManifest): Promise<void> {
    if (!(manifest instanceof AgentManifest)) {
      throw new TypeError("Agent Manifest is invalid");
    }
    const existing = this.#manifests.get(manifest.manifestId);
    if (existing && existing.manifestDigest !== manifest.manifestDigest) {
      throw new AgentManifestStoreError("manifest_conflict");
    }
    this.#manifests.set(manifest.manifestId, manifest);
  }

  async get(manifestId: string): Promise<AgentManifest | undefined> {
    return this.#manifests.get(manifestId);
  }

  async getByAgent(
    agentType: string,
    definitionVersion: string,
  ): Promise<readonly AgentManifest[]> {
    return Object.freeze(
      [...this.#manifests.values()]
        .filter(
          (manifest) =>
            manifest.agentType === agentType &&
            manifest.definitionVersion === definitionVersion,
        )
        .sort(compareManifests),
    );
  }
}

function compareManifests(left: AgentManifest, right: AgentManifest): number {
  const createdAtDifference = left.createdAt.localeCompare(right.createdAt);
  return createdAtDifference !== 0
    ? createdAtDifference
    : left.manifestId.localeCompare(right.manifestId);
}
