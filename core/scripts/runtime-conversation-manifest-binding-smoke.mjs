import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  ConversationRuntimeBootstrapValidationError,
  StorageConversationRuntimeBootstrapFactory,
  captureConversationAgentManifestBinding,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

const conversationId = "conversation:manifest-binding";
const manifestId = "manifest:binding";
const manifestDigest = `sha256:${"a".repeat(64)}`;
const snapshot = Object.freeze({
  metadata: Object.freeze({
    id: conversationId,
    workspaceId: "workspace-binding",
    rootConversationId: conversationId,
    status: "active",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    lastJournalSequence: 0,
  }),
  activeAgentBinding: Object.freeze({
    id: "binding:manifest",
    conversationId,
    revision: 1,
    agentType: "novel_agent",
    definitionVersion: "1.0.0",
    manifestId,
    manifestDigest,
    status: "active",
    createdAt: "2026-08-03T00:00:00.000Z",
  }),
});
const workspace = {
  workspaceId: "workspace-binding",
  workspaceRoot: "/workspace/private",
  storeDir: "/store/private",
  storeDirName: "workspace-binding-store",
  databasePath: "/store/private/core.sqlite",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};
const journal = {
  async getHighWatermark() { return 0; },
  async getBySequence() { return undefined; },
};
const request = {
  conversationId,
  runtimeInstanceId: "runtime-manifest-binding",
  activatedAt: "2026-08-03T00:00:01.000Z",
  activation: { reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore },
};
const validStore = {
  async save() {},
  async get(id) {
    return id === manifestId
      ? { manifestId, manifestDigest, agentType: "novel_agent", definitionVersion: "1.0.0" }
      : undefined;
  },
  async getByAgent() { return []; },
};

const bootstrap = await new StorageConversationRuntimeBootstrapFactory({
  snapshotReader: { async getSnapshot() { return snapshot; } },
  journal,
  workspace,
  agentManifestStore: validStore,
}).create(request);
assert.equal(bootstrap.conversation.activeAgentBinding.manifestId, manifestId);
assert.equal(bootstrap.conversation.activeAgentBinding.manifestDigest, manifestDigest);

await assert.rejects(
  new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: { async getSnapshot() { return snapshot; } },
    journal,
    workspace,
  }).create(request),
  (error) =>
    error instanceof ConversationRuntimeBootstrapValidationError &&
    error.reason === "agent_manifest_missing",
);
await assert.rejects(
  new StorageConversationRuntimeBootstrapFactory({
    snapshotReader: { async getSnapshot() { return snapshot; } },
    journal,
    workspace,
    agentManifestStore: {
      ...validStore,
      async get() {
        return { manifestId, manifestDigest: `sha256:${"b".repeat(64)}`, agentType: "novel_agent", definitionVersion: "1.0.0" };
      },
    },
  }).create(request),
  (error) =>
    error instanceof ConversationRuntimeBootstrapValidationError &&
    error.reason === "agent_manifest_mismatch",
);

assert.deepEqual(
  captureConversationAgentManifestBinding(snapshot.activeAgentBinding),
  {
    agentType: "novel_agent",
    definitionVersion: "1.0.0",
    manifestId,
    manifestDigest,
  },
);
assert.throws(
  () => captureConversationAgentManifestBinding({
    agentType: "novel_agent",
    definitionVersion: "1.0.0",
    manifestId,
  }),
  /incomplete/,
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-manifest-binding-"));
let sqliteStore;
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  sqliteStore = await SqliteWorkspaceStore.open({ workspace: location });
  await sqliteStore.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel_agent",
      definitionVersion: "1.0.0",
      manifestId,
      manifestDigest,
    },
  });
  const stored = await sqliteStore.conversations.getConversation(conversationId);
  assert.equal(stored.activeAgentBinding.manifestId, manifestId);
  assert.equal(stored.activeAgentBinding.manifestDigest, manifestDigest);
} finally {
  await sqliteStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Conversation Manifest binding smoke passed");
