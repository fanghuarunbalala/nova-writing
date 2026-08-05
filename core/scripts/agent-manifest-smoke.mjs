import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AgentAssembler,
  AgentDefinition,
  AgentManifestResolver,
  AgentCapabilityProfileResolver,
  AgentManifestStoreError,
  AgentToolPolicy,
  AgentDelegationPolicy,
  AgentCommunicationPolicy,
  InMemoryAgentManifestStore,
  InlinePromptItem,
  PromptCapabilitySnapshot,
  PromptRecipe,
  PromptSectionItem,
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolRegistry,
  createDefaultAgentCapabilityProfileCatalog,
  createDefaultPromptSectionRegistry,
  defineTool,
  loadToolGroupManifest,
  novelAgentDefinition,
  hydrateAgentManifest,
} from "../dist/index.js";
import { Type } from "typebox";
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  novelOutlineToolRegistry,
} from "./fixtures/novel-outline-tools.mjs";

class Sha256Digester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

const capabilities = new PromptCapabilitySnapshot([{
  name: "TodoWrite",
  version: "1.0.0",
  label: "Todo Write",
  description: "Maintains the current execution plan.",
}]);
const builder = new SystemPromptBuilder({
  sections: createDefaultPromptSectionRegistry(),
  digester: new Sha256Digester(),
});
const logRecords = [];
const logger = {
  debug(event, fields) { logRecords.push({ event, fields }); },
  info(event, fields) { logRecords.push({ event, fields }); },
  warn() {},
  error() {},
  child() { return this; },
};

function createResolver(createdAt = "2026-08-03T00:00:00.000Z") {
  return new AgentManifestResolver({
    promptBuilder: builder,
    promptCapabilities: capabilities,
    manifestIdFactory: {
      create() { return "manifest:novel-agent-preview"; },
    },
    clock: { now() { return createdAt; } },
    digester: new Sha256Digester(),
    logger,
  });
}

const manifest = await createResolver().resolve(novelAgentDefinition);
assert.equal(manifest.agentType, "novel");
assert.equal(manifest.definitionVersion, "1.0.0");
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.capabilityProfile.profileId, "communication.standalone");
assert.equal(manifest.capabilityProfile.communicationRole, "standalone");
assert.deepEqual(
  manifest.promptRecipe.items.map((item) =>
    item.kind === "section" ? `${item.sectionId}@${item.version}` : item.sourceId,
  ),
  [
    "core.runtime.protocol@1.0.0",
    "agent.identity@1.0.0",
    "conversation.behavior@1.0.0",
    "inline:4",
    "tool.guidance@1.0.0",
    "todo.guidance@1.0.0",
    "context.reliability@1.0.0",
    "completion.contract@1.0.0",
  ],
);
assert.equal(manifest.tools[0].name, "TodoWrite");
assert.equal(manifest.tools[0].version, "1.0.0");
assert.match(manifest.manifestDigest, /^sha256:[0-9a-f]{64}$/);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.tools), true);
assert.equal(Object.isFrozen(manifest.promptRecipe), true);
assert.equal(Object.isFrozen(manifest.toSnapshot()), true);
assert.throws(() => { manifest.agentType = "changed"; }, TypeError);

const hydrated = hydrateAgentManifest(manifest.toSnapshot());
assert.equal(hydrated.capabilityProfile.profileId, "communication.standalone");
assert.deepEqual(
  hydrated.capabilityProfile.toolPolicy.toSnapshot(),
  manifest.capabilityProfile.toolPolicy.toSnapshot(),
);
const legacySnapshot = { ...manifest.toSnapshot(), schemaVersion: 1 };
delete legacySnapshot.capabilityProfile;
const hydratedLegacy = hydrateAgentManifest(legacySnapshot);
assert.equal(hydratedLegacy.schemaVersion, 2);
assert.equal(hydratedLegacy.capabilityProfile.profileId, "communication.standalone");

const sameManifest = await createResolver().resolve(novelAgentDefinition);
assert.equal(sameManifest.manifestDigest, manifest.manifestDigest);

const todoTool = defineTool({
  descriptor: {
    name: "TodoWrite",
    version: "1.0.0",
    label: "Todo Write",
    description: "Maintains the current execution plan.",
    parameters: Type.Object({}),
  },
  handler: { async execute() { return { content: [] }; } },
});
const toolRegistry = new ToolRegistry([
  todoTool,
  ...novelOutlineToolRegistry.list(),
]);
const toolGroups = new ToolGroupCatalog([
  loadToolGroupManifest(`
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
`),
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
]);
const assembledStore = new InMemoryAgentManifestStore();
const assembled = await new AgentAssembler({
  registry: toolRegistry,
  groups: toolGroups,
  capabilityResolver: new AgentCapabilityProfileResolver({
    profiles: createDefaultAgentCapabilityProfileCatalog(),
    promptSections: createDefaultPromptSectionRegistry(),
    toolGroups,
  }),
  manifestResolver: createResolver(),
  manifestStore: assembledStore,
  logger,
}).assemble(novelAgentDefinition);
assert.equal(assembled.agentType, "novel");
assert.equal(assembled.toolView.require("TodoWrite").descriptor.name, todoTool.descriptor.name);
assert.equal(assembled.toolView.require("TodoWrite").descriptor.version, todoTool.descriptor.version);
assert.deepEqual(
  assembled.toSnapshot().tools.map((tool) => tool.name).sort(),
  ["NovelOutlineEdit", "NovelOutlineRead", "NovelOutlineWrite", "TodoWrite"],
);
assert.equal(await assembledStore.get(assembled.manifest.manifestId), assembled.manifest);

const store = new InMemoryAgentManifestStore();
await store.save(manifest);
assert.equal(await store.get(manifest.manifestId), manifest);
assert.deepEqual(await store.getByAgent("novel", "1.0.0"), [manifest]);

const conflictingManifest = await createResolver("2026-08-03T00:00:01.000Z")
  .resolve(novelAgentDefinition);
await assert.rejects(
  store.save(conflictingManifest),
  (error) => error instanceof AgentManifestStoreError && error.failure === "manifest_conflict",
);

const missingSectionDefinition = new AgentDefinition({
  agentType: "invalid_agent",
  definitionVersion: "1.0.0",
  label: "Invalid Agent",
  description: "Used to validate required Prompt Sections.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new InlinePromptItem("Missing completion section."),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
await assert.rejects(
  createResolver().resolve(missingSectionDefinition),
  /Required Prompt Section is missing/,
);

const loggedText = JSON.stringify(logRecords);
assert.equal(loggedText.includes(manifest.compiledPrompt.content), false);

console.log("Agent Manifest architecture smoke passed");
