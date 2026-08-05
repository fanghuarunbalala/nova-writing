import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  AgentAssembler,
  AgentDefinitionCatalog,
  AgentManifestResolver,
  CatalogHostChildConversationAdapter,
  DefaultChildConversationManager,
  DefaultSubagentLifecycleCoordinator,
  DurableChildConversationManager,
  PromptCapabilitySnapshot,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_TOOL_POLICY_RELATION,
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolRegistry,
  createCoreEventSchemaRegistry,
  createDefaultPromptSectionRegistry,
  defineTool,
  loadToolGroupManifest,
  novelAgentDefinition,
} from "../dist/index.js";
import { SqliteSubagentBindingStore, SqliteWorkspaceStore } from "../dist/node/index.js";
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

const root = await mkdtemp(join(tmpdir(), "novel-subagent-6b-"));
const timestamp = "2026-08-02T11:00:00.000Z";
const workspace = { workspaceId: "workspace-subagent", workspaceRoot: root, storeDir: join(root, ".novel"), storeDirName: ".novel", databasePath: join(root, ".novel", "core.sqlite"), createdAt: timestamp, updatedAt: timestamp };

try {
  const workspaceStore = await SqliteWorkspaceStore.open({ workspace });
  await workspaceStore.conversations.createConversation({ id: "conversation-parent", workspaceId: workspace.workspaceId, agent: { agentType: "main", definitionVersion: "v1" }, createdAt: timestamp });
  const database = new DatabaseSync(workspace.databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  const bindingStore = new SqliteSubagentBindingStore(database);
  const hostCalls = [];
  const host = {
    async notifyAccepted() {},
    async getRuntimePresence() { return { state: "offline", observedAt: timestamp }; },
    async ensureActive(request) { hostCalls.push(["activate", request]); return { status: "activated", presence: { state: "online", observedAt: timestamp } }; },
    async shutdownRuntime(request) { hostCalls.push(["shutdown", request]); return { status: "stopped", presence: { state: "offline", observedAt: timestamp } }; },
    async close() {},
  };
  const adapter = new CatalogHostChildConversationAdapter({
    catalog: workspaceStore.conversations,
    host,
    agentDefinitions: new AgentDefinitionCatalog([novelAgentDefinition]),
    agentAssembler: createAgentAssembler(workspaceStore),
    idFactory: { create(input) { return `conversation-child-${input.subagentId}`; } },
  });
  const baseManager = new DefaultChildConversationManager({
    parentScopeReader: { async readParentScope(input) { return { parentConversationId: input.parentConversationId, parentRunId: input.parentRunId, workspaceId: workspace.workspaceId, depth: 0, toolPolicyId: "policy-parent" }; } },
    toolPolicyRelationReader: { async readRelation() { return SUBAGENT_TOOL_POLICY_RELATION.reduced; } },
    creationPort: adapter,
    activationPort: adapter,
    rollbackPort: adapter,
    clock: { now: () => timestamp },
  });
  const manager = new DurableChildConversationManager(baseManager, bindingStore);
  const registry = createCoreEventSchemaRegistry();
  const events = [];
  const lifecycle = new DefaultSubagentLifecycleCoordinator({ manager, eventSink: { async append(event) { const snapshot = registry.validateOutput(event.getSnapshot()); events.push(snapshot); return { status: "recorded", conversationId: snapshot.conversationId, eventId: snapshot.id, sequence: events.length, recordedAt: snapshot.timestamp }; } }, eventIdFactory: { create(input) { return `event-${input.subagentId}-${input.eventType}-${input.ordinal}`; } }, clock: { now: () => timestamp } });
  const handle = await lifecycle.start({ schemaVersion: SUBAGENT_SCHEMA_VERSION, subagentId: "sqlite", parentConversationId: "conversation-parent", parentRunId: "run-parent", agentType: "novel", definitionVersion: "1.0.0", objective: "private objective", toolPolicyId: "policy-child", requestedAt: timestamp });
  const child = await workspaceStore.conversations.getConversation(handle.binding.childConversationId);
  assert.equal(child.metadata.parentConversationId, "conversation-parent");
  assert.equal(child.activeAgentBinding.manifestId, "manifest:subagent:novel_agent");
  assert.match(child.activeAgentBinding.manifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    (await workspaceStore.agentManifests.get(child.activeAgentBinding.manifestId)).toSnapshot().definition,
    novelAgentDefinition.toSnapshot(),
  );
  assert.equal(hostCalls[0][0], "activate");
  await lifecycle.deliverResult({ schemaVersion: SUBAGENT_SCHEMA_VERSION, subagentId: "sqlite", parentConversationId: "conversation-parent", parentRunId: "run-parent", childConversationId: handle.binding.childConversationId, status: "completed", summary: "bounded result", artifactReferences: [], completedAt: timestamp });
  assert.equal((await bindingStore.get("sqlite")).status, "completed");
  database.close();
  const reopened = new DatabaseSync(workspace.databasePath);
  assert.equal((await new SqliteSubagentBindingStore(reopened).get("sqlite")).status, "completed");
  reopened.close();
  await workspaceStore.close();
  console.log("Runtime Subagent Host SQLite integration smoke passed");
} finally {
  await rm(root, { recursive: true, force: true });
}

function createAgentAssembler(workspaceStore) {
  const digester = new Sha256Digester();
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
  return new AgentAssembler({
    registry: new ToolRegistry([tool, ...novelOutlineToolRegistry.list()]),
    groups: new ToolGroupCatalog([
      loadToolGroupManifest(`
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
`),
      NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
    ]),
    manifestResolver: new AgentManifestResolver({
      promptBuilder: new SystemPromptBuilder({
        sections: createDefaultPromptSectionRegistry(),
        digester,
      }),
      promptCapabilities: new PromptCapabilitySnapshot([]),
      manifestIdFactory: { create() { return "manifest:subagent:novel_agent"; } },
      clock: { now() { return "2026-08-03T03:00:00.000Z"; } },
      digester,
    }),
    manifestStore: workspaceStore.agentManifests,
  });
}
