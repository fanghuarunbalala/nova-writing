import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  AGENT_RUNTIME_BOOTSTRAP_FAILURE,
  AgentAssembler,
  AgentAssemblyRestorer,
  AgentManifestResolver,
  AgentRuntimeBootstrapError,
  AgentRuntimeConfigurationFactory,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
  InMemoryAgentManifestStore,
  InMemoryAgentRuntimeConfigurationProfileResolver,
  PromptCapabilitySnapshot,
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolRegistry,
  createDefaultPromptSectionRegistry,
  defineTool,
  loadToolGroupManifest,
  novelAgentDefinition,
} from "../dist/index.js";
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  novelCharacterToolRegistry,
  novelOutlineToolRegistry,
} from "./fixtures/novel-outline-tools.mjs";

class Sha256Digester {
  algorithm = "sha256";
  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

function todoTool(version = "1.0.0") {
  return defineTool({
    descriptor: {
      name: "TodoWrite",
      version,
      label: "Todo Write",
      description: "Maintains the current execution plan.",
      parameters: Type.Object({}),
    },
    handler: { async execute() { return { content: [] }; } },
  });
}

const groups = new ToolGroupCatalog([
  loadToolGroupManifest(`
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
  `),
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
]);
const registry = new ToolRegistry([
  todoTool(),
  ...novelOutlineToolRegistry.list(),
  ...novelCharacterToolRegistry.list(),
]);
const manifestStore = new InMemoryAgentManifestStore();
const resolver = new AgentManifestResolver({
  promptBuilder: new SystemPromptBuilder({
    sections: createDefaultPromptSectionRegistry(),
    digester: new Sha256Digester(),
  }),
  promptCapabilities: new PromptCapabilitySnapshot([]),
  manifestIdFactory: { create() { return "manifest:runtime-bootstrap"; } },
  clock: { now() { return "2026-08-03T00:00:00.000Z"; } },
  digester: new Sha256Digester(),
});
const assembly = await new AgentAssembler({
  registry,
  groups,
  manifestResolver: resolver,
  manifestStore,
}).assemble(novelAgentDefinition);
const profileResolver = new InMemoryAgentRuntimeConfigurationProfileResolver([{
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
}]);
const bootstrap = Object.freeze({
  schemaVersion: 1,
  runtimeInstanceId: "runtime-bootstrap",
  activatedAt: "2026-08-03T00:00:01.000Z",
  conversation: Object.freeze({
    metadata: Object.freeze({
      id: "conversation:runtime-bootstrap",
      workspaceId: "workspace-bootstrap",
      rootConversationId: "conversation:runtime-bootstrap",
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: "binding-bootstrap",
      conversationId: "conversation:runtime-bootstrap",
      revision: 1,
      agentType: assembly.agentType,
      definitionVersion: assembly.definitionVersion,
      manifestId: assembly.manifest.manifestId,
      manifestDigest: assembly.manifest.manifestDigest,
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
    }),
  }),
  workspace: Object.freeze({
    workspaceId: "workspace-bootstrap",
    workdir: "/private/workdir",
  }),
  activation: Object.freeze({ reason: "explicit_restore" }),
  journal: Object.freeze({ highWatermark: 0 }),
});
const factory = new AgentRuntimeConfigurationFactory({
  manifestStore,
  assemblyRestorer: new AgentAssemblyRestorer({ registry, groups }),
  profileResolver,
});
const configuration = await factory.create(bootstrap);
assert.equal(configuration.conversationId, "conversation:runtime-bootstrap");
assert.equal(configuration.assembly.manifest, assembly.manifest);
assert.equal(
  configuration.assembly.systemPrompt.digest,
  assembly.systemPrompt.digest,
);
assert.deepEqual(
  configuration.assembly.toSnapshot().tools.map((tool) => tool.name).sort(),
  [
    "NovelCharacterEdit",
    "NovelCharacterRead",
    "NovelCharacterWrite",
    "NovelOutlineEdit",
    "NovelOutlineRead",
    "NovelOutlineWrite",
    "TodoWrite",
  ],
);

await assert.rejects(
  factory.create({
    ...bootstrap,
    conversation: {
      ...bootstrap.conversation,
      activeAgentBinding: {
        ...bootstrap.conversation.activeAgentBinding,
        manifestDigest: `sha256:${"f".repeat(64)}`,
      },
    },
  }),
  (error) =>
    error instanceof AgentRuntimeBootstrapError &&
    error.failure === AGENT_RUNTIME_BOOTSTRAP_FAILURE.manifestMismatch,
);
assert.throws(
  () => new AgentAssemblyRestorer({
    registry: new ToolRegistry([
      todoTool("2.0.0"),
      ...novelOutlineToolRegistry.list(),
      ...novelCharacterToolRegistry.list(),
    ]),
    groups,
  }).restore(assembly.manifest),
  /does not match Agent Manifest/,
);

console.log("Agent Runtime Bootstrap smoke passed");
