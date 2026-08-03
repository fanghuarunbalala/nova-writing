import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiRemoteError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../dist/index.js";
import {
  NodeConversationApiApplication,
  NodeWorkspaceStoreLocator,
} from "../dist/node/index.js";

class TestRuntimeHandle {
  constructor(conversationId, runtimeInstanceId) {
    this.conversationId = conversationId;
    this.runtimeInstanceId = runtimeInstanceId;
    this.inputs = [];
    this.shutdownRequests = [];
    this.exit = deferred();
  }

  async dispatchInput(input) {
    this.inputs.push(input);
  }

  async shutdown(request) {
    this.shutdownRequests.push(request);
    this.exit.resolve({
      kind: "stopped",
      exitedAt: "2026-08-03T02:30:00.000Z",
      reason: request.reason,
    });
  }

  waitForExit() {
    return this.exit.promise;
  }
}

class TestRuntimePlacement {
  constructor() {
    this.handles = [];
    this.bootstraps = [];
  }

  async activate(bootstrap) {
    this.bootstraps.push(bootstrap);
    const handle = new TestRuntimeHandle(
      bootstrap.conversation.metadata.id,
      bootstrap.runtimeInstanceId,
    );
    this.handles.push(handle);
    return handle;
  }
}

class IncrementingClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    const value = new Date(Date.UTC(2026, 7, 3, 2, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class RuntimeInstanceIdGenerator {
  generate() {
    return "rt_node_conversation_api";
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-conversation-api-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-node-api";
const privateText = "PRIVATE_NODE_CONVERSATION_API_TEXT";
const logs = [];

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const firstPlacement = new TestRuntimePlacement();
  const firstApplication = await NodeConversationApiApplication.open({
    workspace,
    placement: firstPlacement,
    clock: new IncrementingClock(),
    runtimeInstanceIdGenerator: new RuntimeInstanceIdGenerator(),
    conversationIdGenerator: { generate: () => conversationId },
    subscriptionPageSize: 2,
    logger: createCollectingLogger(logs),
  });
  const firstClient = new DefaultNovelApiClient({
    transport: firstApplication.transport,
    requestIdFactory: createRequestIdFactory("first"),
    logger: createCollectingLogger(logs),
  });
  const firstConversation = await firstClient.conversations.create({
    agent: {
      agentType: "conversation.main",
      definitionVersion: "1",
    },
  });
  assert.equal(firstConversation.id, conversationId);
  const firstCatalog = await firstClient.conversations.list({ status: "active" });
  assert.equal(firstCatalog.conversations.length, 1);
  assert.equal(Object.isFrozen(firstCatalog.conversations), true);
  assert.equal(Object.isFrozen(firstCatalog.conversations[0]), true);
  assert.equal(firstCatalog.conversations[0].metadata.id, conversationId);
  assert.equal(
    firstCatalog.conversations[0].activeAgentBinding.agentType,
    "conversation.main",
  );
  await assert.rejects(
    firstClient.conversations.create({
      conversationId: "conversation-node-api-missing-parent",
      parentConversationId: "missing-parent",
      agent: {
        agentType: "conversation.subagent",
        definitionVersion: "1",
      },
    }),
    (error) =>
      error instanceof ApiRemoteError &&
      error.code === "CONVERSATION_PARENT_NOT_FOUND" &&
      error.category === "not-found",
  );
  assert.equal((await firstConversation.getRuntimePresence()).state, "offline");
  const live = firstConversation.events.subscribe({
    start: { from: "start" },
    liveBufferCapacity: 16,
  });
  const receipt = await firstConversation.input.enqueue(
    new UserMessageInputEvent({
      id: "input-node-api-1",
      timestamp: "2026-08-03T02:00:01.000Z",
      text: privateText,
    }),
  );
  assert.equal(receipt.sequence, 1);
  await waitUntil(
    () => firstPlacement.handles[0]?.inputs.length === 1,
    "Node Conversation API Runtime dispatch",
  );
  assert.equal((await firstConversation.getRuntimePresence()).state, "online");

  const observed = [];
  for (let index = 0; index < 3; index += 1) {
    const next = await live.next();
    assert.equal(next.done, false);
    observed.push(next.value);
  }
  assert.deepEqual(
    observed.map((event) => [event.sequence, event.eventType]),
    [
      [1, "user.message"],
      [2, "system.runtime.presence.changed"],
      [3, "system.runtime.presence.changed"],
    ],
  );
  await firstConversation.close();
  await firstApplication.close();
  assert.equal(firstPlacement.handles[0].shutdownRequests.length, 1);

  const secondPlacement = new TestRuntimePlacement();
  const secondApplication = await NodeConversationApiApplication.open({
    workspace,
    placement: secondPlacement,
    clock: new IncrementingClock(),
    runtimeInstanceIdGenerator: new RuntimeInstanceIdGenerator(),
    logger: createCollectingLogger(logs),
  });
  const secondClient = new DefaultNovelApiClient({
    transport: secondApplication.transport,
    requestIdFactory: createRequestIdFactory("second"),
    logger: createCollectingLogger(logs),
  });
  const reopenedCatalog = await secondClient.conversations.list();
  assert.equal(reopenedCatalog.conversations.length, 1);
  assert.equal(reopenedCatalog.conversations[0].metadata.id, conversationId);
  const secondConversation = await secondClient.conversations.open(conversationId);
  const replay = await secondConversation.events.list({
    anchor: { from: "start" },
    limit: 10,
  });
  assert.equal(replay.events.length, 5);
  assert.equal(replay.highWatermark, 5);
  assert.deepEqual(
    replay.events.map((event) => event.eventType),
    [
      "user.message",
      "system.runtime.presence.changed",
      "system.runtime.presence.changed",
      "system.runtime.presence.changed",
      "system.runtime.presence.changed",
    ],
  );
  assert.equal(secondPlacement.handles.length, 0);
  assert.equal((await secondConversation.getRuntimePresence()).state, "offline");
  await secondConversation.close();
  await secondApplication.close();

  const serializedLogs = JSON.stringify(logs);
  for (const forbidden of [
    privateText,
    workspaceRoot,
    storageRoot,
    workspace.storeDir,
    workspace.databasePath,
  ]) {
    assert.equal(serializedLogs.includes(forbidden), false);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("node conversation api application smoke passed");

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function createRequestIdFactory(prefix) {
  let value = 0;
  return () => `${prefix}-node-conversation-api-${++value}`;
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() {
      return this;
    },
  };
}
