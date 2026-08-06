import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  AgentAssembler,
  AgentManifestStoreError,
  AgentManifest,
  AgentManifestPrompt,
  AgentManifestTool,
  AgentManifestDelegation,
  InMemoryAgentManifestStore,
  AgentManifestResolver,
  PromptCapabilitySnapshot,
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolRegistry,
  createDefaultPromptSectionRegistry,
  defineTool,
  loadToolGroupManifest,
  novelAgentDefinition,
  ResolvedPromptRecipe,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";
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

const tool = defineTool({
  descriptor: {
    name: "TodoWrite",
    version: "1.0.0",
    label: "Todo Write",
    description: "Maintains the current execution plan.",
    parameters: Type.Object({}),
  },
  handler: { async execute() { return { content: [] }; } },
});
const resolver = new AgentManifestResolver({
  promptBuilder: new SystemPromptBuilder({
    sections: createDefaultPromptSectionRegistry(),
    digester: new Sha256Digester(),
  }),
  promptCapabilities: new PromptCapabilitySnapshot([]),
  manifestIdFactory: { create() { return "manifest:sqlite"; } },
  clock: { now() { return "2026-08-03T00:00:00.000Z"; } },
  digester: new Sha256Digester(),
});
const manifest = await new AgentAssembler({
  registry: new ToolRegistry([
    tool,
    ...novelOutlineToolRegistry.list(),
    ...novelCharacterToolRegistry.list(),
    ...novelLocationToolRegistry.list(),
    ...novelParagraphToolRegistry.list(),
    ...novelPublicationToolRegistry.list(),
    ...novelDeleteToolRegistry.list(),
    ...novelDraftToolRegistry.list(),
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
    NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
    NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  ]),
  manifestResolver: resolver,
  manifestStore: new InMemoryAgentManifestStore(),
}).assemble(novelAgentDefinition).then((assembly) => assembly.manifest);

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-agent-manifest-sqlite-"));
let workspaceStore;
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(workspaceRoot);
  workspaceStore = await SqliteWorkspaceStore.open({ workspace });
  await workspaceStore.agentManifests.save(manifest);
  await workspaceStore.agentManifests.save(manifest);
  const restored = await workspaceStore.agentManifests.get(manifest.manifestId);
  assert.notEqual(restored, manifest);
  assert.deepEqual(restored.toSnapshot(), manifest.toSnapshot());
  assert.equal(Object.isFrozen(restored), true);
  assert.deepEqual(
    (await workspaceStore.agentManifests.getByAgent("novel", "1.0.0"))
      .map((value) => value.manifestId),
    [manifest.manifestId],
  );

  const conflicting = new AgentManifest({
    manifestId: manifest.manifestId,
    manifestDigest: `sha256:${"f".repeat(64)}`,
    definition: novelAgentDefinition,
    promptRecipe: new ResolvedPromptRecipe([...manifest.promptRecipe.items]),
    compiledPrompt: new AgentManifestPrompt({
      content: manifest.compiledPrompt.content,
      digest: manifest.compiledPrompt.digest,
    }),
    tools: [new AgentManifestTool({ name: "TodoWrite", version: "1.0.0" })],
    delegation: new AgentManifestDelegation({ mode: "disabled", allowedAgentTypes: [] }),
    communicationRole: "standalone",
    runtimePolicyId: "default",
    createdAt: manifest.createdAt,
  });
  await assert.rejects(
    workspaceStore.agentManifests.save(conflicting),
    (error) => error instanceof AgentManifestStoreError && error.failure === "manifest_conflict",
  );
} finally {
  await workspaceStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Agent Manifest SQLite smoke passed");
