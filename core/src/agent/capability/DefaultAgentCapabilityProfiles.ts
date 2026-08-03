/** Default role profiles that preserve the current Agent Tool and Prompt surfaces. */
import { AgentCapabilityProfile } from "./AgentCapabilityProfile.js";
import { AgentCapabilityProfileCatalog } from "./AgentCapabilityProfileCatalog.js";

export const standaloneAgentCapabilityProfile = new AgentCapabilityProfile({
  profileId: "communication.standalone",
  version: "1.0.0",
  communicationRole: "standalone",
});

export const ephemeralSubagentCapabilityProfile = new AgentCapabilityProfile({
  profileId: "communication.ephemeral_subagent",
  version: "1.0.0",
  communicationRole: "ephemeral_subagent",
});

export function createDefaultAgentCapabilityProfileCatalog(): AgentCapabilityProfileCatalog {
  return new AgentCapabilityProfileCatalog([
    standaloneAgentCapabilityProfile,
    ephemeralSubagentCapabilityProfile,
  ]);
}
