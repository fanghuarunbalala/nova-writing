import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_OUTBOX_DISPATCH_FAILURE,
  NovelOutboxDispatchError,
  NovelOutboxDispatcher,
  ConversationNovelLifecycleOutputPublisher,
  captureNovelLifecycleRecord,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelOutboxStore,
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
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

class ControlledOutputPublisher {
  constructor(outcomes) {
    this.outcomes = [...outcomes];
    this.snapshots = [];
    this.sequence = 0;
  }
  async publish(event) {
    const snapshot = event.getSnapshot();
    this.snapshots.push(snapshot);
    const outcome = this.outcomes.shift();
    if (outcome?.kind === "throw") throw new Error("provider detail");
    this.sequence += 1;
    return Object.freeze({
      status: outcome?.status ?? "recorded",
      conversationId:
        outcome?.conversationId ?? snapshot.conversationId,
      outputEventId: outcome?.outputEventId ?? snapshot.id,
      sequence: outcome?.sequence ?? this.sequence,
      recordedAt:
        outcome?.recordedAt ?? "2026-08-02T13:30:00.000Z",
    });
  }
}

function lifecycleRecord({ eventId, novelId, occurredAt }) {
  return captureNovelLifecycleRecord({
    recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
    eventId,
    eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted,
    novelId,
    conversationId: "conversation-outbox-dispatcher",
    occurredAt: captureNovelTimestamp(occurredAt),
    payload: {
      scope: "draft",
      outcome: "verified",
      affectedCount: 1,
    },
  });
}

async function expectDispatchFailure(action, expectedFailure) {
  await assert.rejects(action, (error) => {
    assert.equal(error instanceof NovelOutboxDispatchError, true);
    assert.equal(error.failure, expectedFailure);
    assert.equal(error.message, "Novel lifecycle Outbox dispatch failed");
    assert.equal(Object.hasOwn(error, "cause"), false);
    return true;
  });
}

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const field of [
      "path",
      "sql",
      "eventJson",
      "payload",
      "message",
      "stack",
      "cause",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-outbox-dispatcher-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let outboxStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, logger });
  const metadata = await canonicalStore.getMetadata();
  const writer = new SqliteNovelLifecycleRecordWriter(
    location,
    metadata.novelId,
  );
  const first = lifecycleRecord({
    eventId: "outbox-dispatch:first",
    novelId: metadata.novelId,
    occurredAt: "2026-08-02T13:00:00.000Z",
  });
  const second = lifecycleRecord({
    eventId: "outbox-dispatch:second",
    novelId: metadata.novelId,
    occurredAt: "2026-08-02T13:01:00.000Z",
  });
  await writer.recordCanonical(second);
  await writer.recordCanonical(first);
  outboxStore = await SqliteNovelOutboxStore.openCanonical({
    location,
    novelId: metadata.novelId,
    logger,
  });

  const failingOutput = new ControlledOutputPublisher([{ kind: "throw" }]);
  const failingDispatcher = new NovelOutboxDispatcher({
    store: outboxStore,
    publisher: new ConversationNovelLifecycleOutputPublisher(failingOutput),
    pageSize: 2,
    logger,
  });
  await expectDispatchFailure(
    () => failingDispatcher.dispatchPending(),
    NOVEL_OUTBOX_DISPATCH_FAILURE.publisherFailed,
  );
  assert.deepEqual(
    failingOutput.snapshots.map((snapshot) => snapshot.id),
    [first.eventId],
  );
  const afterFailure = await outboxStore.listPending({ limit: 10 });
  assert.deepEqual(
    afterFailure.entries.map((entry) => [
      entry.record.eventId,
      entry.attemptCount,
    ]),
    [
      [first.eventId, 1],
      [second.eventId, 0],
    ],
  );

  const retryOutput = new ControlledOutputPublisher([
    {
      status: "duplicate",
      recordedAt: "2026-08-02T13:10:00.000Z",
    },
    {
      status: "recorded",
      recordedAt: "2026-08-02T13:11:00.000Z",
    },
  ]);
  const retryResult = await new NovelOutboxDispatcher({
    store: outboxStore,
    publisher: new ConversationNovelLifecycleOutputPublisher(retryOutput),
    pageSize: 1,
    logger,
  }).dispatchPending();
  assert.deepEqual(retryResult, {
    source: { kind: "canonical" },
    attemptedCount: 2,
    recordedCount: 1,
    duplicateCount: 1,
    alreadyPublishedCount: 0,
  });
  assert.deepEqual(
    retryOutput.snapshots.map((snapshot) => snapshot.id),
    [first.eventId, second.eventId],
  );
  for (const snapshot of retryOutput.snapshots) {
    assert.equal(snapshot.eventType, "novel.recovery.completed");
    assert.equal(snapshot.conversationId, first.conversationId);
    assert.equal(snapshot.payload.novelId, metadata.novelId);
    assert.equal(Object.hasOwn(snapshot.payload, "text"), false);
  }

  const publicationDatabase = new DatabaseSync(
    location.canonicalDatabasePath,
    { readOnly: true },
  );
  const publicationRows = publicationDatabase
    .prepare(
      `SELECT event_id, published_at, attempt_count
       FROM novel_outbox
       WHERE event_id IN (?, ?)
       ORDER BY created_at, event_id`,
    )
    .all(first.eventId, second.eventId)
    .map((row) => ({ ...row }));
  publicationDatabase.close();
  assert.deepEqual(publicationRows, [
    {
      event_id: first.eventId,
      published_at: "2026-08-02T13:10:00.000Z",
      attempt_count: 2,
    },
    {
      event_id: second.eventId,
      published_at: "2026-08-02T13:11:00.000Z",
      attempt_count: 1,
    },
  ]);

  await outboxStore.close();
  outboxStore = await SqliteNovelOutboxStore.openCanonical({
    location,
    novelId: metadata.novelId,
    logger,
  });
  const restartedResult = await new NovelOutboxDispatcher({
    store: outboxStore,
    publisher: new ConversationNovelLifecycleOutputPublisher(
      new ControlledOutputPublisher([]),
    ),
    logger,
  }).dispatchPending();
  assert.deepEqual(restartedResult, {
    source: { kind: "canonical" },
    attemptedCount: 0,
    recordedCount: 0,
    duplicateCount: 0,
    alreadyPublishedCount: 0,
  });

  const invalidReceiptRecord = lifecycleRecord({
    eventId: "outbox-dispatch:invalid-receipt",
    novelId: metadata.novelId,
    occurredAt: "2026-08-02T13:20:00.000Z",
  });
  await writer.recordCanonical(invalidReceiptRecord);
  const invalidReceiptOutput = new ControlledOutputPublisher([
    { conversationId: "wrong-conversation" },
  ]);
  await expectDispatchFailure(
    () =>
      new NovelOutboxDispatcher({
        store: outboxStore,
        publisher: new ConversationNovelLifecycleOutputPublisher(
          invalidReceiptOutput,
        ),
        logger,
      }).dispatchPending(),
    NOVEL_OUTBOX_DISPATCH_FAILURE.invalidPublisherReceipt,
  );
  const pendingInvalid = await outboxStore.listPending({ limit: 10 });
  assert.equal(pendingInvalid.entries.length, 1);
  assert.equal(pendingInvalid.entries[0].record.eventId, invalidReceiptRecord.eventId);
  assert.equal(pendingInvalid.entries[0].attemptCount, 1);

  const recoveredResult = await new NovelOutboxDispatcher({
    store: outboxStore,
    publisher: new ConversationNovelLifecycleOutputPublisher(
      new ControlledOutputPublisher([
        {
          status: "duplicate",
          recordedAt: "2026-08-02T13:21:00.000Z",
        },
      ]),
    ),
    logger,
  }).dispatchPending();
  assert.equal(recoveredResult.duplicateCount, 1);

  assertRedacted(logs, [root, "provider detail", JSON.stringify(first.payload)]);
} finally {
  await outboxStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel outbox dispatcher smoke passed");
