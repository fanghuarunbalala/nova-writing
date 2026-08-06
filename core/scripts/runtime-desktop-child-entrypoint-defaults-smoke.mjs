import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
} from "../dist/index.js";
import {
  DefaultNovelConversationManifestProvisioner,
  DESKTOP_CHILD_STORAGE_ROOT_ENV,
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
  createChildProcessConversationRuntimePlacement,
} from "../dist/node/index.js";

const conversationId = "conversation-entrypoint-defaults";
const fixturePath = fileURLToPath(
  new URL("./fixtures/runtime-desktop-child-entrypoint.mjs", import.meta.url),
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-child-defaults-"));
try {
  const workspaceRoot = join(temporaryRoot, "workspace");
  const storageRoot = join(temporaryRoot, "storage");
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({
    storageRoot,
  }).resolve(workspaceRoot);
  const provisioner = new DefaultNovelConversationManifestProvisioner();
  const seedStore = await SqliteWorkspaceStore.open({ workspace: location });
  const seeded = await provisioner.provision(seedStore.agentManifests);
  await seedStore.close();

  const placement = createChildProcessConversationRuntimePlacement({
    command: process.execPath,
    args: [fixturePath],
    env: { [DESKTOP_CHILD_STORAGE_ROOT_ENV]: storageRoot },
    persistenceProvider: {
      provide: async () => ({
        journalReader: {
          async getHighWatermark() {
            return 0;
          },
          async getBySequence() {
            return undefined;
          },
          async getByEventId() {
            return undefined;
          },
          async list(query) {
            return {
              events: [],
              highWatermark: 0,
              hasPrevious: false,
              hasNext: false,
            };
          },
        },
        journalService: {
          async append() {
            throw new Error("append is outside this smoke scope");
          },
          async close() {},
        },
        messageStore: {
          async list() {
            return {
              conversationId,
              items: [],
              highWatermarkMessageIndex: 0,
              projectedThroughSequence: 0,
              hasMore: false,
            };
          },
        },
      }),
    },
  });
  const handle = await placement.activate(
    createBootstrap(seeded, location.workspaceId, workspaceRoot),
  );
  assert.equal(handle.conversationId, conversationId);
  await handle.shutdown({
    reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
  });
  assert.equal((await withTimeout(handle.waitForExit())).kind, "stopped");
  await placement.close();
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Desktop Runtime child entrypoint defaults smoke passed");

function createBootstrap(seeded, workspaceId, workdir) {
  return Object.freeze({
    schemaVersion: 1,
    runtimeInstanceId: "runtime-entrypoint-defaults",
    activatedAt: "2026-08-04T09:00:00.000Z",
    conversation: Object.freeze({
      metadata: Object.freeze({
        id: conversationId,
        workspaceId,
        rootConversationId: conversationId,
        status: "active",
        createdAt: "2026-08-04T09:00:00.000Z",
        updatedAt: "2026-08-04T09:00:00.000Z",
        lastJournalSequence: 0,
      }),
      activeAgentBinding: Object.freeze({
        id: "binding-entrypoint-defaults",
        conversationId,
        revision: 1,
        agentType: seeded.agentType,
        definitionVersion: seeded.definitionVersion,
        manifestId: seeded.manifestId,
        manifestDigest: seeded.manifestDigest,
        status: "active",
        createdAt: "2026-08-04T09:00:00.000Z",
      }),
    }),
    workspace: Object.freeze({
      workspaceId,
      workdir,
    }),
    activation: Object.freeze({ reason: "explicit_restore" }),
    journal: Object.freeze({ highWatermark: 0 }),
  });
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(
        () => reject(new Error("Timed out waiting for child exit")),
        15_000,
      );
    }),
  ]);
}
