import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import {
  ClearContextInputEvent,
  CompactContextInputEvent,
  CoreConversationInputRoutePolicy,
  EventPayload,
  InputEvent,
  InputRejectedError,
  PublishingConversationJournalService,
  ReloadConfigInputEvent,
  StopInputEvent,
  StorageConversationCommandService,
  UserMessageInputEvent,
  createCoreEventSchemaRegistry,
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

class FailingEventHub {
  async publish() {
    const error = new Error("FORBIDDEN_LIVE_PUBLICATION_FAILURE");
    error.code = "LIVE_UNAVAILABLE";
    throw error;
  }

  subscribe() {
    throw new Error("command smoke does not subscribe to the failing hub");
  }

  async close() {}
}

class JournalCheckingNotifier {
  constructor(journal) {
    this.journal = journal;
    this.signals = [];
    this.failureEventIds = new Set();
  }

  async notifyAccepted(signal) {
    const durable = await this.journal.getBySequence(
      signal.conversationId,
      signal.sequence,
    );
    assert.ok(durable, "Host notification must happen after Journal persistence");
    assert.equal(durable.id, signal.inputEventId);
    assert.equal(durable.eventType, signal.eventType);
    this.signals.push(signal);
    if (this.failureEventIds.has(signal.inputEventId)) {
      const error = new Error("FORBIDDEN_HOST_NOTIFICATION_FAILURE");
      error.code = "HOST_QUEUE_UNAVAILABLE";
      throw error;
    }
  }
}

class ObjectPayload extends EventPayload {
  constructor(value) {
    super();
    this.value = value;
  }

  toObject() {
    return this.value;
  }
}

class CustomInputEvent extends InputEvent {
  constructor({ eventType, priority, payload = {}, ...options }) {
    super(options);
    this.eventType = eventType;
    this.priority = priority;
    this.payload = new ObjectPayload(payload);
  }

  getEventType() {
    return this.eventType;
  }

  getPriority() {
    return this.priority;
  }

  getPayload() {
    return this.payload;
  }
}

function assertRejectedWithCode(code) {
  return (error) => error instanceof InputRejectedError && error.code === code;
}

function setConversationStatus(databasePath, conversationId, status) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const result = database
      .prepare("UPDATE conversations SET status = ? WHERE id = ?")
      .run(status, conversationId);
    assert.equal(Number(result.changes), 1);
  } finally {
    database.close();
  }
}

function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    assert.equal(Object.hasOwn(entry.fields, "payload"), false);
    assert.equal(Object.hasOwn(entry.fields, "config"), false);
    assert.equal(Object.hasOwn(entry.fields, "message"), false);
    assert.equal(Object.hasOwn(entry.fields, "stack"), false);
    assert.equal(Object.hasOwn(entry.fields, "cause"), false);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-conversation-command-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const conversationId = "conversation-command-integration";
const secretText = "FORBIDDEN_USER_NOVEL_TEXT";
const logEntries = [];
const logger = new CollectingLogger(logEntries);

let store;
let publisher;
let hub;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const location = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const registry = createCoreEventSchemaRegistry();
  registry.register({
    kind: "input",
    eventType: "agent.steer",
    schemaVersion: 1,
    priority: 600,
    payloadSchema: Type.Object(
      { direction: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  });

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

  hub = new FailingEventHub();
  publisher = new PublishingConversationJournalService({
    journal: store.journal,
    hub,
    logger,
  });
  const notifier = new JournalCheckingNotifier(store.journal);
  const commandService = new StorageConversationCommandService({
    metadataStore: store.conversations,
    journalService: publisher,
    eventSchemaRegistry: registry,
    routePolicy: new CoreConversationInputRoutePolicy(),
    acceptedInputNotifier: notifier,
    logger,
  });

  const firstInput = new UserMessageInputEvent({
    id: "input-user-1",
    timestamp: "2026-08-01T00:00:00.000Z",
    text: secretText,
  });
  const firstReceipt = await commandService.enqueue(conversationId, firstInput);
  assert.deepEqual(firstReceipt, {
    status: "accepted",
    conversationId,
    inputEventId: "input-user-1",
    sequence: 1,
    acceptedAt: firstReceipt.acceptedAt,
  });
  assert.equal(Object.isFrozen(firstReceipt), true);
  assert.deepEqual(notifier.signals[0].route, {
    target: "runtime",
    activation: "required",
  });
  assert.equal(JSON.stringify(notifier.signals[0]).includes(secretText), false);

  const duplicateReceipt = await commandService.enqueue(conversationId, firstInput);
  assert.equal(duplicateReceipt.status, "duplicate");
  assert.equal(duplicateReceipt.sequence, 1);
  assert.equal(notifier.signals.length, 2);
  assert.equal(notifier.signals[1].journalStatus, "duplicate");

  const stopReceipt = await commandService.enqueue(
    conversationId,
    new StopInputEvent({
      id: "input-stop-2",
      timestamp: "2026-08-01T00:00:01.000Z",
      runId: "run-target",
    }),
  );
  assert.equal(stopReceipt.sequence, 2);
  assert.deepEqual(notifier.signals.at(-1).route, {
    target: "host",
    handler: "stop",
    runtimeNotification: "if_online",
  });
  assert.equal(notifier.signals.at(-1).runId, "run-target");

  await commandService.enqueue(
    conversationId,
    new ReloadConfigInputEvent({
      id: "input-reload-3",
      timestamp: "2026-08-01T00:00:02.000Z",
      config: { runtime: "agent", locale: "zh-CN" },
    }),
  );
  assert.deepEqual(notifier.signals.at(-1).route, {
    target: "host",
    handler: "reload_config",
    runtimeNotification: "if_online",
  });

  await commandService.enqueue(
    conversationId,
    new ClearContextInputEvent({
      id: "input-clear-4",
      timestamp: "2026-08-01T00:00:03.000Z",
    }),
  );
  assert.deepEqual(notifier.signals.at(-1).route, {
    target: "runtime",
    activation: "required",
  });

  await commandService.enqueue(
    conversationId,
    new CompactContextInputEvent({
      id: "input-compact-5",
      timestamp: "2026-08-01T00:00:04.000Z",
    }),
  );
  assert.deepEqual(notifier.signals.at(-1).route, {
    target: "runtime",
    activation: "required",
  });

  await commandService.enqueue(
    conversationId,
    new CustomInputEvent({
      id: "input-custom-6",
      timestamp: "2026-08-01T00:00:05.000Z",
      eventType: "agent.steer",
      priority: 600,
      payload: { direction: "continue" },
    }),
  );
  assert.deepEqual(notifier.signals.at(-1).route, {
    target: "runtime",
    activation: "required",
  });

  notifier.failureEventIds.add("input-notify-failure-7");
  const notificationFailureReceipt = await commandService.enqueue(
    conversationId,
    new UserMessageInputEvent({
      id: "input-notify-failure-7",
      timestamp: "2026-08-01T00:00:06.000Z",
      text: "notification still durable",
    }),
  );
  assert.equal(notificationFailureReceipt.status, "accepted");
  assert.ok(
    await store.journal.getBySequence(
      conversationId,
      notificationFailureReceipt.sequence,
    ),
  );

  await assert.rejects(
    commandService.enqueue(
      conversationId,
      new CustomInputEvent({
        id: "input-unknown",
        eventType: "agent.unknown",
        priority: 600,
      }),
    ),
    assertRejectedWithCode("unknown_event_type"),
  );
  await assert.rejects(
    commandService.enqueue(
      conversationId,
      new UserMessageInputEvent({
        id: "input-mismatch",
        conversationId: "another-conversation",
        text: "mismatch",
      }),
    ),
    assertRejectedWithCode("conversation_id_mismatch"),
  );
  await assert.rejects(
    commandService.enqueue(
      "missing-conversation",
      new UserMessageInputEvent({ id: "input-missing", text: "missing" }),
    ),
    assertRejectedWithCode("conversation_not_found"),
  );

  const concurrentReceipts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      commandService.enqueue(
        conversationId,
        new UserMessageInputEvent({
          id: `input-concurrent-${index}`,
          timestamp: `2026-08-01T00:01:${String(index).padStart(2, "0")}.000Z`,
          text: `concurrent-${index}`,
        }),
      ),
    ),
  );
  assert.deepEqual(
    concurrentReceipts.map((receipt) => receipt.sequence),
    [8, 9, 10, 11, 12, 13, 14, 15],
  );

  setConversationStatus(location.databasePath, conversationId, "archived");
  const duplicateAfterArchive = await commandService.enqueue(conversationId, firstInput);
  assert.equal(duplicateAfterArchive.status, "duplicate");
  assert.equal(duplicateAfterArchive.sequence, 1);

  await assert.rejects(
    commandService.enqueue(
      conversationId,
      new UserMessageInputEvent({
        id: "input-archived-new",
        text: "must not persist",
      }),
    ),
    assertRejectedWithCode("conversation_not_accepting_input"),
  );
  await assert.rejects(
    commandService.enqueue(
      conversationId,
      new UserMessageInputEvent({
        id: "input-user-1",
        timestamp: "2026-08-01T00:00:00.000Z",
        text: "conflicting replacement",
      }),
    ),
    assertRejectedWithCode("event_id_conflict"),
  );

  setConversationStatus(location.databasePath, conversationId, "disposed");
  await assert.rejects(
    commandService.enqueue(
      conversationId,
      new UserMessageInputEvent({
        id: "input-disposed-new",
        text: "must not persist either",
      }),
    ),
    assertRejectedWithCode("conversation_not_accepting_input"),
  );

  const page = await store.journal.list({
    conversationId,
    anchor: { from: "start" },
    direction: "input",
    limit: 100,
  });
  assert.equal(page.highWatermark, 15);
  assert.equal(page.events.length, 15);
  assert.equal(page.events.some((event) => event.id === "input-archived-new"), false);
  assert.equal(page.events.some((event) => event.id === "input-disposed-new"), false);

  assert.ok(
    logEntries.some(
      (entry) => entry.event === "conversation.command.host_notification_failed",
    ),
  );
  assert.ok(
    logEntries.some(
      (entry) =>
        entry.event === "conversation_journal.live.failed" &&
        entry.fields.errorCode === "LIVE_UNAVAILABLE",
    ),
  );
  assertLogsAreRedacted(logEntries, [
    secretText,
    "FORBIDDEN_LIVE_PUBLICATION_FAILURE",
    "FORBIDDEN_HOST_NOTIFICATION_FAILURE",
  ]);
} finally {
  if (publisher !== undefined) await publisher.close().catch(() => undefined);
  if (hub !== undefined) await hub.close().catch(() => undefined);
  if (store !== undefined) await store.close().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("conversation command integration smoke passed");
