/** Provider-neutral asynchronous storage Port for immutable Agent Manifests. */
import type { AgentManifest } from "./AgentManifest.js";

export interface AgentManifestStore {
  save(manifest: AgentManifest): Promise<void>;
  get(manifestId: string): Promise<AgentManifest | undefined>;
  getByAgent(
    agentType: string,
    definitionVersion: string,
  ): Promise<readonly AgentManifest[]>;
}
