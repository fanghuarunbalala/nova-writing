import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  ConversationOutputConflictError,
  ConversationOutputPersistenceError,
  ConversationOutputRejectedError,
  createCoreEventSchemaRegistry,
  InMemoryConversationEventHub,
  OutputPayload,
  PublishingConversationJournalService,
  StorageConversationOutputEventPublisher,
  SystemOutputEvent,
} from "../dist/index.js";
import {
  NodeWorkspaceStoreLocator,
  SqliteWorkspaceStore,
} from "../dist/node/index.js";

class CollectingLogger {
  constructor(entries, bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

class ObjectOutputPayload extends OutputPayload {
  constructor(value) {
    super();
    this.value = value;
  }

  toObject() {
    return this.value;
  }
}

class TestSystemOutputEvent extends SystemOutputEvent {
  constructor({ payload, ...options }) {
    super("test.output", new ObjectOutputPayload(payload), options);
  }
}

class UnknownSystemOutputEvent extends SystemOutputEvent {
  constructor(options) {
    super("unknown.output", new ObjectOutputPayload({}), options);
  }
}

class FailingEventHub {
  async publish() {
    const error = new Error("FORBIDDEN_LIVE_PUBLICATION_MESSAGE");
    error.code = "LIVE_PUBLICATION_FAILED";
    throw error;
  }

  subscribe() {
    throw new Error("not used");
  }

  async close() {}
}

class FailingJournalService {
  async append() {
    const error = new Error("FORBIDDEN_PERSISTENCE_MESSAGE");
    error.code = "STORAGE_UNAVAILABLE";
    throw error;
  }

  async close() {}
}

function registerTestOutputSchema(registry) {
  registry.register({
    kind: "output",
    eventType: "system.test.output",
    schemaVersion: 1,
    payloadSchema: Type.Object(
      { marker: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  });
}

function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const forbiddenField of [
      "payload",
      "config",
      "prompt",
      "tool",
      "path",
      "message",
      "stack",
      "cause",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, forbiddenField), false);
    }
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-output-publishing-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-output-publishing";
const secretMarker = "FORBIDDEN_OUTPUT_PAYLOAD_TEXT";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

let store;
let journalService;
let hub;
let subscription;
let failingJournalService;
let failingHub;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const registry = createCoreEventSchemaRegistry();
  registerTestOutputSchema(registry);

  store = await SqliteWorkspaceStore.open({
    workspace: location,
    eventSchemaRegistry: registry,
    logger,
  });
  await store.conversations.createConversation({
    id: conversationId,
    workspaceId: location.workspaceId,
    agent: {
      agentType: "novel.main",
      definitionVersion: "1",
    },
  });

  hub = new InMemoryConversationEventHub({ logger });
  subscription = hub.subscribe({ conversationId });
  journalService = new PublishingConversationJournalService({
    journal: store.journal,
    hub,
    logger,
  });
  const outputPublisher = new StorageConversationOutputEventPublisher({
    eventSchemaRegistry: registry,
    journalService,
    logger,
  });

  const event = new TestSystemOutputEvent({
    conversationId,
    id: "output-system-1",
    timestamp: "2026-08-01T00:00:00.000Z",
    correlationId: "correlation-output-1",
    payload: { marker: secretMarker },
  });
  const liveEventPromise = subscription.next();
  const receipt = await outputPublisher.publish(event);
  assert.deepEqual(receipt, {
    status: "recorded",
    conversationId,
    outputEventId: "output-system-1",
    sequence: 1,
    recordedAt: receipt.recordedAt,
  });
  assert.equal(Object.isFrozen(receipt), true);

  const liveEvent = await liveEventPromise;
  assert.equal(liveEvent.done, false);
  assert.equal(liveEvent.value.direction, "output");
  assert.equal(liveEvent.value.sequence, 1);
  assert.equal(liveEvent.value.payload.marker, secretMarker);

  const duplicateReceipt = await outputPublisher.publish(event);
  assert.equal(duplicateReceipt.status, "duplicate");
  assert.equal(duplicateReceipt.sequence, 1);

  await assert.rejects(
    outputPublisher.publish(
      new TestSystemOutputEvent({
        conversationId,
        id: "output-system-1",
        timestamp: "2026-08-01T00:00:00.000Z",
        payload: { marker: "different-value" },
      }),
    ),
    (error) =>
      error instanceof ConversationOutputConflictError &&
      error.code === "CONVERSATION_OUTPUT_CONFLICT",
  );

  await assert.rejects(
    outputPublisher.publish(
      new UnknownSystemOutputEvent({
        conversationId,
        id: "output-unknown-2",
        timestamp: "2026-08-01T00:00:01.000Z",
      }),
    ),
    (error) =>
      error instanceof ConversationOutputRejectedError &&
      error.reason === "unknown_event_type",
  );

  await assert.rejects(
    outputPublisher.publish(
      new TestSystemOutputEvent({
        conversationId,
        id: "output-invalid-3",
        timestamp: "2026-08-01T00:00:02.000Z",
        payload: { marker: Number.POSITIVE_INFINITY },
      }),
    ),
    (error) =>
      error instanceof ConversationOutputRejectedError &&
      error.reason === "invalid_event",
  );

  await journalService.close();
  journalService = undefined;
  await subscription.close();
  subscription = undefined;
  await hub.close();
  hub = undefined;

  failingHub = new FailingEventHub();
  failingJournalService = new PublishingConversationJournalService({
    journal: store.journal,
    hub: failingHub,
    logger,
  });
  const degradedPublisher = new StorageConversationOutputEventPublisher({
    eventSchemaRegistry: registry,
    journalService: failingJournalService,
    logger,
  });
  const degradedReceipt = await degradedPublisher.publish(
    new TestSystemOutputEvent({
      conversationId,
      id: "output-live-failure-4",
      timestamp: "2026-08-01T00:00:03.000Z",
      payload: { marker: "live-failure-still-durable" },
    }),
  );
  assert.equal(degradedReceipt.status, "recorded");
  assert.equal(degradedReceipt.sequence, 2);

  const persistencePublisher = new StorageConversationOutputEventPublisher({
    eventSchemaRegistry: registry,
    journalService: new FailingJournalService(),
    logger,
  });
  await assert.rejects(
    persistencePublisher.publish(
      new TestSystemOutputEvent({
        conversationId,
        id: "output-persistence-failure-5",
        timestamp: "2026-08-01T00:00:04.000Z",
        payload: { marker: "persistence-failure" },
      }),
    ),
    (error) =>
      error instanceof ConversationOutputPersistenceError &&
      error.errorName === "Error" &&
      error.errorCode === "STORAGE_UNAVAILABLE",
  );

  await failingJournalService.close();
  failingJournalService = undefined;
  await failingHub.close();
  failingHub = undefined;
  await store.close();
  store = undefined;

  const reopenedStore = await SqliteWorkspaceStore.open({
    workspace: location,
    eventSchemaRegistry: registry,
    logger,
  });
  try {
    const page = await reopenedStore.journal.list({
      conversationId,
      anchor: { from: "start" },
      direction: "output",
      limit: 10,
    });
    assert.equal(page.highWatermark, 2);
    assert.deepEqual(
      page.events.map((persisted) => ({
        id: persisted.id,
        direction: persisted.direction,
        sequence: persisted.sequence,
      })),
      [
        { id: "output-system-1", direction: "output", sequence: 1 },
        { id: "output-live-failure-4", direction: "output", sequence: 2 },
      ],
    );
  } finally {
    await reopenedStore.close();
  }

  assert.equal(
    logEntries.some(
      (entry) => entry.event === "conversation.output.live_publication_failed",
    ),
    true,
  );
  assert.equal(
    logEntries.some(
      (entry) => entry.event === "conversation.output.persistence_failed",
    ),
    true,
  );
  assertLogsAreRedacted(logEntries, [
    secretMarker,
    "FORBIDDEN_LIVE_PUBLICATION_MESSAGE",
    "FORBIDDEN_PERSISTENCE_MESSAGE",
    workspaceRoot,
    storageRoot,
    location.storeDir,
    location.databasePath,
  ]);
} finally {
  if (journalService) await journalService.close();
  if (subscription) await subscription.close();
  if (hub) await hub.close();
  if (failingJournalService) await failingJournalService.close();
  if (failingHub) await failingHub.close();
  if (store) await store.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("conversation output publishing smoke passed");
