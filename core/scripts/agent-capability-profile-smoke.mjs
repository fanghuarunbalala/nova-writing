import assert from "node:assert/strict";
import {
  AgentCapabilityProfile,
  AgentCapabilityProfileCatalog,
  AgentCapabilityProfileError,
  AGENT_CAPABILITY_PROFILE_FAILURE,
  createDefaultAgentCapabilityProfileCatalog,
  ephemeralSubagentCapabilityProfile,
  standaloneAgentCapabilityProfile,
} from "../dist/index.js";

const catalog = createDefaultAgentCapabilityProfileCatalog();
assert.equal(catalog.resolve("communication.standalone"), standaloneAgentCapabilityProfile);
assert.equal(
  catalog.resolve("communication.ephemeral_subagent"),
  ephemeralSubagentCapabilityProfile,
);
assert.deepEqual(catalog.list().map((profile) => profile.profileId), [
  "communication.ephemeral_subagent",
  "communication.standalone",
]);
assert.equal(standaloneAgentCapabilityProfile.communicationRole, "standalone");
assert.deepEqual(standaloneAgentCapabilityProfile.defaultPromptSectionIds, []);
assert.deepEqual(standaloneAgentCapabilityProfile.defaultToolGroupIds, []);
assert.equal(Object.isFrozen(standaloneAgentCapabilityProfile), true);
assert.equal(Object.isFrozen(standaloneAgentCapabilityProfile.toSnapshot()), true);

const newer = new AgentCapabilityProfile({
  profileId: "communication.standalone",
  version: "1.1.0",
  communicationRole: "standalone",
  defaultChannelIds: ["user-facing"],
});
const versioned = new AgentCapabilityProfileCatalog([
  standaloneAgentCapabilityProfile,
  newer,
]);
assert.equal(versioned.resolve("communication.standalone"), newer);
assert.equal(
  versioned.resolve("communication.standalone", "1.0.0"),
  standaloneAgentCapabilityProfile,
);

assert.throws(
  () => new AgentCapabilityProfileCatalog([
    standaloneAgentCapabilityProfile,
    standaloneAgentCapabilityProfile,
  ]),
  (error) =>
    error instanceof AgentCapabilityProfileError &&
    error.failure === AGENT_CAPABILITY_PROFILE_FAILURE.duplicateProfile,
);
assert.throws(
  () => catalog.resolve("communication.missing"),
  (error) =>
    error instanceof AgentCapabilityProfileError &&
    error.failure === AGENT_CAPABILITY_PROFILE_FAILURE.unknownProfile,
);

console.log("Agent Capability Profile architecture smoke passed");
