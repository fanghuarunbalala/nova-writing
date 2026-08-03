import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  RUNTIME_PERSISTENCE_RPC_METHOD,
  RuntimeIpcRemoteError,
  RuntimePersistenceProtocolError,
  RuntimePersistenceRequestError,
  captureRuntimeJournalGetEventRequest,
  captureRuntimeJournalListEventsResponse,
  captureRuntimeRecoverySnapshot,
  captureRuntimeStateLoadRequest,
  createInMemoryRuntimeIpcConnectionPair,
  RuntimeIpcPeer,
} from "../dist/index.js";
import {
  ChildRuntimePersistenceClient,
  ParentRuntimePersistenceHandler,
} from "../dist/node/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const conversationId = "conversation-persistence";
const secretContent = "PRIVATE_NOVEL_TEXT_DO_NOT_LOG";
const output = createOutput("event-output-1", secretContent);
const persisted = Object.freeze({
  ...output,
  direction: "output",
  sequence: 1,
  recordedAt: "2026-08-02T00:00:01.000Z",
});
const messageRecord = createMessageRecord();
const logs = [];
const logger = new CollectingLogger(logs);
let appendCount = 0;
let listCancellationStarted;
const cancellationStarted = new Promise((resolve) => { listCancellationStarted = resolve; });
const never = new Promise(() => {});

const journalReader = {
  async getHighWatermark(requestConversationId) {
    assert.equal(requestConversationId, conversationId);
    return 4;
  },
  async getBySequence(requestConversationId, sequence) {
    assert.equal(requestConversationId, conversationId);
    return sequence === 1 ? persisted : undefined;
  },
  async getByEventId() { return undefined; },
  async list(query) {
    assert.equal(query.conversationId, conversationId);
    if ("afterSequence" in query.anchor && query.anchor.afterSequence === 999) {
      listCancellationStarted();
      return never;
    }
    return Object.freeze({
      events: Object.freeze([persisted]),
      highWatermark: Math.min(query.throughSequence ?? 4, 4),
      hasPrevious: false,
      hasNext: false,
    });
  },
};

const journalService = {
  async append(request) {
    appendCount += 1;
    const receipt = Object.freeze({
      status: appendCount === 1 ? "appended" : "duplicate",
      conversationId,
      eventId: request.snapshot.id,
      direction: "output",
      sequence: 2,
      recordedAt: "2026-08-02T00:00:02.000Z",
    });
    return Object.freeze({
      receipt,
      event: Object.freeze({
        ...request.snapshot,
        direction: "output",
        sequence: receipt.sequence,
        recordedAt: receipt.recordedAt,
      }),
      livePublication: Object.freeze({
        status: "failed",
        errorName: "LivePublicationUnavailable",
        errorCode: "LIVE_UNAVAILABLE",
      }),
    });
  },
  async close() {},
};

const messageStore = {
  async list(query) {
    assert.equal(query.conversationId, conversationId);
    return Object.freeze({
      conversationId,
      items: Object.freeze([messageRecord]),
      highWatermarkMessageIndex: 1,
      projectedThroughSequence: 1,
      hasMore: false,
    });
  },
};

const nudgeSnapshot = Object.freeze({
  schemaVersion: 1,
  nudges: Object.freeze([Object.freeze({
    id: "nudge-1",
    policyId: "policy-1",
    templateId: "template-1",
    templateVersion: "1.0.0",
    priority: 10,
    dedupeKey: "run-1:max-turns",
    parameters: Object.freeze({}),
    exclusive: false,
    placement: "system-prompt-overlay",
    delivery: "once",
    state: "scheduled",
    targetRunId: "run-1",
    scheduledSequence: 3,
    scheduledAt: "2026-08-02T00:00:03.000Z",
  })]),
  leases: Object.freeze([]),
  consumptions: Object.freeze([]),
});
const checkpoint = createCheckpoint();
const interaction = createInteractionSnapshot();

const handler = new ParentRuntimePersistenceHandler({
  conversationId,
  journalReader,
  journalService,
  messageStore,
  pendingNudgeStore: { async snapshot() { return nudgeSnapshot; } },
  contextCheckpointStore: { async getActive() { return checkpoint; } },
  interactionCoordinator: { async snapshot() { return interaction; } },
  logger,
});
const pair = createInMemoryRuntimeIpcConnectionPair();
const parentPeer = new RuntimeIpcPeer({
  sessionId: "session-persistence",
  connection: pair.first,
  requestHandler: handler,
  requestErrorMapper: handler,
  logger,
});
const childPeer = new RuntimeIpcPeer({
  sessionId: "session-persistence",
  connection: pair.second,
  logger,
});
parentPeer.start();
childPeer.start();
const client = new ChildRuntimePersistenceClient({ requester: childPeer, logger });

assert.deepEqual(
  Object.values(RUNTIME_PERSISTENCE_RPC_METHOD).sort(),
  [
    "journal.appendOutput",
    "journal.getEvent",
    "journal.listEvents",
    "messages.list",
    "runtimeState.load",
  ],
);
assert.equal((await client.journal.getEvent(conversationId, 1)).id, output.id);
assert.equal(await client.journal.getEvent(conversationId, 2), undefined);
const eventPage = await client.journal.listEvents({
  conversationId,
  anchor: { from: "start" },
  throughSequence: 4,
  direction: "output",
  eventTypes: [output.eventType],
  limit: 10,
});
assert.equal(eventPage.events[0].sequence, 1);
assert.equal(Object.isFrozen(eventPage), true);
assert.equal(Object.isFrozen(eventPage.events), true);

const appended = await client.journal.appendOutput(conversationId, output);
assert.deepEqual(appended, {
  status: "appended",
  conversationId,
  eventId: output.id,
  sequence: 2,
  recordedAt: "2026-08-02T00:00:02.000Z",
});
const duplicate = await client.journal.appendOutput(conversationId, output);
assert.equal(duplicate.status, "duplicate");
assert.equal(appendCount, 2);

const messagePage = await client.messages.list({ conversationId, limit: 5 });
assert.equal(messagePage.items[0].message.payload.content[0].text, secretContent);
assert.equal(Object.isFrozen(messagePage.items[0].message), true);

const recovery = await client.runtimeState.load(conversationId);
assert.equal(recovery.capturedThroughSequence, 4);
assert.equal(recovery.nudge.nudges[0].id, "nudge-1");
assert.equal(recovery.contextCheckpoint.id, "checkpoint-1");
assert.equal(recovery.interaction.pending[0].approvalRequestId, "approval-1");
assert.equal(Object.isFrozen(recovery), true);
assert.equal(Object.isFrozen(recovery.interaction.pending), true);

const minimalHandler = new ParentRuntimePersistenceHandler({
  conversationId,
  journalReader,
  journalService,
  messageStore,
});
const minimalSnapshot = captureRuntimeRecoverySnapshot(
  await minimalHandler.handle(
    RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad,
    { conversationId },
    { sessionId: "session-direct", requestId: "request-direct", signal: new AbortController().signal },
  ),
  conversationId,
);
assert.deepEqual(Object.keys(minimalSnapshot), [
  "schemaVersion",
  "conversationId",
  "capturedThroughSequence",
]);

await assert.rejects(
  childPeer.request("journal.executeSql", { sql: "DROP TABLE events" }),
  (error) => error instanceof RuntimeIpcRemoteError &&
    error.code === "RUNTIME_PERSISTENCE_METHOD_NOT_ALLOWED" &&
    error.category === "protocol",
);
await assert.rejects(
  childPeer.request(RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad, {
    conversationId: "conversation-other",
  }),
  (error) => error instanceof RuntimeIpcRemoteError && error.category === "conflict",
);
assert.throws(
  () => captureRuntimeStateLoadRequest({ conversationId, namespace: "private" }),
  RuntimePersistenceProtocolError,
);
assert.throws(
  () => captureRuntimeJournalListEventsResponse({
    events: [persisted],
    highWatermark: 4,
    hasPrevious: false,
    hasNext: false,
  }, {
    conversationId,
    anchor: { from: "start" },
    eventTypes: ["system.some.other.event"],
    limit: 10,
  }),
  RuntimePersistenceProtocolError,
);
const accessorNudges = [];
Object.defineProperty(accessorNudges, "0", {
  enumerable: true,
  get() { return nudgeSnapshot.nudges[0]; },
});
accessorNudges.length = 1;
assert.throws(
  () => captureRuntimeRecoverySnapshot({
    schemaVersion: 1,
    conversationId,
    capturedThroughSequence: 4,
    nudge: {
      schemaVersion: 1,
      nudges: accessorNudges,
      leases: [],
      consumptions: [],
    },
  }),
  RuntimePersistenceProtocolError,
);
assert.throws(
  () => captureRuntimeJournalGetEventRequest({ conversationId, sequence: 1, path: "/private/store" }),
  RuntimePersistenceProtocolError,
);
assert.throws(
  () => captureRuntimeRecoverySnapshot({
    schemaVersion: 1,
    conversationId,
    capturedThroughSequence: 0,
    namespace: "arbitrary-state",
  }),
  RuntimePersistenceProtocolError,
);

const malformedClient = new ChildRuntimePersistenceClient({
  requester: {
    async request() { return { found: false, path: "/private/store" }; },
  },
});
await assert.rejects(
  malformedClient.journal.getEvent(conversationId, 1),
  RuntimePersistenceProtocolError,
);

const cancellationController = new AbortController();
const cancelled = client.journal.listEvents({
  conversationId,
  anchor: { afterSequence: 999 },
  limit: 1,
}, { signal: cancellationController.signal });
await cancellationStarted;
cancellationController.abort();
await assert.rejects(
  cancelled,
  (error) => error instanceof RuntimePersistenceRequestError && error.failure === "cancelled",
);

await Promise.all([childPeer.close(), parentPeer.close()]);

const declarationDirectory = new URL("../dist/runtime/ipc/persistence/", import.meta.url);
const declarationText = (
  await Promise.all(
    (await readdir(declarationDirectory))
      .filter((name) => name.endsWith(".d.ts"))
      .map((name) => readFile(new URL(name, declarationDirectory), "utf8")),
  )
).join("\n");
for (const forbiddenDeclaration of ["node:", "@earendil", "PiAgent", "RuntimeIpcPeer"]) {
  assert.equal(declarationText.includes(forbiddenDeclaration), false);
}

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(secretContent), false);
for (const forbidden of [
  "payload", "prompt", "toolData", "credential", "workdir", "storeDir",
  "path", "jsonl", "stack", "cause", "stderr",
]) {
  assert.equal(logs.some((entry) => Object.hasOwn(entry.fields, forbidden)), false);
}

console.log("Runtime persistence RPC smoke passed");

function createOutput(id, text) {
  return Object.freeze({
    id,
    conversationId,
    eventType: "system.persistence.tested",
    schemaVersion: 1,
    timestamp: "2026-08-02T00:00:00.000Z",
    payload: Object.freeze({ content: text }),
  });
}

function createMessageRecord() {
  return Object.freeze({
    recordType: "message",
    formatVersion: 1,
    workspaceId: "workspace-persistence",
    conversationId,
    messageIndex: 1,
    source: Object.freeze({
      sequence: 1,
      eventId: output.id,
      eventType: output.eventType,
      direction: "output",
      ordinal: 0,
    }),
    message: Object.freeze({
      id: "message-1",
      conversationId,
      role: "assistant",
      messageType: "assistant.message",
      schemaVersion: 1,
      timestamp: "2026-08-02T00:00:00.000Z",
      payload: Object.freeze({
        content: Object.freeze([Object.freeze({ type: "text", text: secretContent })]),
      }),
    }),
    previousHash: "0".repeat(64),
    recordHash: "1".repeat(64),
  });
}

function createCheckpoint() {
  return Object.freeze({
    schemaVersion: 1,
    id: "checkpoint-1",
    conversationId,
    sourceStartSequence: 1,
    sourceEndSequence: 2,
    coveredThroughSequence: 2,
    sourceDigest: `sha256:${"2".repeat(64)}`,
    summary: "Safe summary",
    facts: Object.freeze([]),
    decisions: Object.freeze([]),
    constraints: Object.freeze([]),
    unresolvedTasks: Object.freeze([]),
    pinnedMessageIds: Object.freeze([]),
    recentWindowStartSequence: 3,
    tokenEstimateBefore: 100,
    tokenEstimateAfter: 20,
    compactorId: "compactor-1",
    compactorVersion: "1.0.0",
    createdAt: "2026-08-02T00:00:03.000Z",
    contentDigest: `sha256:${"3".repeat(64)}`,
  });
}

function createInteractionSnapshot() {
  return Object.freeze({
    schemaVersion: 1,
    pending: Object.freeze([Object.freeze({
      approvalRequestId: "approval-1",
      identity: Object.freeze({
        conversationId,
        runId: "run-1",
        toolCallId: "tool-call-1",
        toolName: "ReadFile",
        toolVersion: "1.0.0",
        argumentDigest: `sha256:${"4".repeat(64)}`,
      }),
      summary: Object.freeze({ title: "Read one file" }),
      requestedAt: "2026-08-02T00:00:03.000Z",
      expiresAt: "2026-08-02T00:01:03.000Z",
    })]),
    resolved: Object.freeze([]),
  });
}
