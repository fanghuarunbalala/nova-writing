import assert from "node:assert/strict";
import {
  AgentCapabilityProfile,
  AgentCapabilityProfileCatalog,
  AgentCapabilityProfileResolver,
  AgentCapabilityProfileError,
  AGENT_CAPABILITY_PROFILE_FAILURE,
  AgentCommunicationPolicy,
  createDefaultAgentCapabilityProfileCatalog,
  createDefaultPromptSectionRegistry,
  AgentDefinition,
  AgentDelegationPolicy,
  AgentToolPolicy,
  InlinePromptItem,
  PromptRecipe,
  PromptSectionItem,
  ToolGroupCatalog,
  loadToolGroupManifest,
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

const toolGroups = new ToolGroupCatalog([
  loadToolGroupManifest(`
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
`),
]);
const resolver = new AgentCapabilityProfileResolver({
  profiles: catalog,
  promptSections: createDefaultPromptSectionRegistry(),
  toolGroups,
});
const definition = new AgentDefinition({
  agentType: "profile_test_agent",
  definitionVersion: "1.0.0",
  label: "Profile Test Agent",
  description: "Validates capability profile resolution.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new InlinePromptItem("Use the resolved capabilities."),
    new PromptSectionItem("completion.contract"),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
const resolved = await resolver.resolve({ definition });
assert.equal(resolved.profileId, "communication.standalone");
assert.deepEqual(resolved.promptSectionIds, [
  "core.runtime.protocol",
  "completion.contract",
]);
assert.deepEqual(resolved.toolPolicy.groupIds, ["runtime.todo"]);
assert.deepEqual(resolved.channelIds, []);
assert.equal(Object.isFrozen(resolved), true);

const mismatchedProfile = new AgentCapabilityProfileCatalog([
  new AgentCapabilityProfile({
    profileId: "custom.standalone",
    version: "1.0.0",
    communicationRole: "orchestrator",
  }),
]);
const mismatchedResolver = new AgentCapabilityProfileResolver({
  profiles: mismatchedProfile,
  promptSections: createDefaultPromptSectionRegistry(),
  toolGroups,
});
await assert.rejects(
  mismatchedResolver.resolve({
    definition,
    profileId: "custom.standalone",
  }),
  (error) =>
    error instanceof AgentCapabilityProfileError &&
    error.failure === AGENT_CAPABILITY_PROFILE_FAILURE.communicationRoleMismatch,
);

console.log("Agent Capability Profile architecture smoke passed");
