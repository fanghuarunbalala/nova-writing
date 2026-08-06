/** Provider-neutral port that provisions a default Agent Manifest into a Store. */
import type { AgentManifest } from "./AgentManifest.js";
import type { AgentManifestStore } from "./AgentManifestStore.js";

export interface AgentManifestProvisioner {
  provision(store: AgentManifestStore): Promise<AgentManifest | undefined>;
}
