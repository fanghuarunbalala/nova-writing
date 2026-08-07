import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  AgentAssembler,
  AgentManifestResolver,
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
  AgentToolPolicy,
  InMemoryAgentManifestStore,
  PromptCapabilitySnapshot,
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolRegistry,
  createDefaultPromptSectionRegistry,
  defineTool,
  loadToolGroupManifest,
  novelAgentDefinition,
} from "../dist/index.js";
import { RUNTIME_FILES_TOOL_GROUP_MANIFEST, createFileToolRegistry, FileToolService } from "../dist/index.js";
import { NOVEL_COMPOSE_TOOL_GROUP_MANIFEST, ComposeToolService, ComposeModeStateProvider, createNovelComposeToolRegistry } from "../dist/index.js";
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  NOVEL_DRAFT_TOOL_GROUP_MANIFEST,
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  novelCharacterToolRegistry,
  novelLocationToolRegistry,
  novelParagraphToolRegistry,
  novelPublicationToolRegistry,
  novelDeleteToolRegistry,
  novelDraftToolRegistry,
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
const resolver = new AgentManifestResolver({
  promptBuilder: builder,
  promptCapabilities: capabilities,
  manifestIdFactory: { create() { return "manifest:runtime-config"; } },
  clock: { now() { return "2026-08-03T00:00:00.000Z"; } },
  digester: new Sha256Digester(),
});
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
const assembly = await new AgentAssembler({
  registry: new ToolRegistry([
    todoTool,
    ...novelOutlineToolRegistry.list(),
    ...novelCharacterToolRegistry.list(),
    ...novelLocationToolRegistry.list(),
    ...novelParagraphToolRegistry.list(),
    ...novelPublicationToolRegistry.list(),
    ...novelDeleteToolRegistry.list(),
    ...novelDraftToolRegistry.list(),
    ...createFileToolRegistry({ service: new FileToolService({ designRoot: "/unavailable/design" }) }).list(),
    ...createNovelComposeToolRegistry({ service: new ComposeToolService({ composeState: new ComposeModeStateProvider(), designRoot: "/unavailable/design" }) }).list(),
  ]),
  groups: new ToolGroupCatalog([
    loadToolGroupManifest(`
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
  `),
    NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
    NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
    NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
    NOVEL_DELETE_TOOL_GROUP_MANIFEST,
    NOVEL_DRAFT_TOOL_GROUP_MANIFEST,
    RUNTIME_FILES_TOOL_GROUP_MANIFEST,
    NOVEL_COMPOSE_TOOL_GROUP_MANIFEST,
    NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
    NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  ]),
  manifestResolver: resolver,
  manifestStore: new InMemoryAgentManifestStore(),
}).assemble(novelAgentDefinition);

const configuration = new AgentRuntimeConfiguration({
  conversationId: "conversation:runtime-config",
  assembly,
  policies: new AgentRuntimePolicyReferences({
    runtimePolicyId: "default",
    contextPolicyId: "default",
    nudgePolicyId: "default",
  }),
  limits: new AgentRuntimeExecutionLimits({
    maximumTurns: 20,
    maximumProviderCallsPerTurn: 2,
    maximumToolCallsPerTurn: 16,
    providerCallTimeoutMs: 60_000,
    toolExecutionTimeoutMs: 30_000,
  }),
});

assert.equal(configuration.conversationId, "conversation:runtime-config");
assert.equal(configuration.assembly, assembly);
assert.equal(configuration.assembly.manifest.runtimePolicyId, "default");
assert.equal(configuration.limits.maximumProviderCallsPerTurn, 2);
assert.equal(Object.isFrozen(configuration), true);
assert.equal(Object.isFrozen(configuration.policies), true);
assert.equal(Object.isFrozen(configuration.limits), true);
assert.equal(Object.isFrozen(configuration.toSnapshot()), true);
assert.throws(() => { configuration.conversationId = "changed"; }, TypeError);

assert.throws(
  () => new AgentRuntimeConfiguration({
    conversationId: "conversation:runtime-config",
    assembly,
    policies: new AgentRuntimePolicyReferences({
      runtimePolicyId: "other",
      contextPolicyId: "default",
      nudgePolicyId: "default",
    }),
    limits: configuration.limits,
  }),
  /Runtime policy does not match Agent Manifest/,
);

console.log("Agent Runtime configuration smoke passed");
