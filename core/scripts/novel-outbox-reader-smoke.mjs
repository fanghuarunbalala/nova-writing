import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_OUTBOX_INTEGRITY_FAILURE,
  NovelOutboxIntegrityError,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelLifecycleRecord,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelOutboxReader,
  digestNovelLifecycleOutboxText,
  initializeNovelDraftSqliteSchema,
  insertDraftNovelLifecycleOutboxRecord,
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

function recoveryRecord({ eventId, novelId, conversationId, occurredAt }) {
  return captureNovelLifecycleRecord({
    recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
    eventId,
    eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted,
    novelId,
    conversationId,
    occurredAt: captureNovelTimestamp(occurredAt),
    payload: {
      scope: "draft",
      outcome: "verified",
      affectedCount: 1,
    },
  });
}

async function assertIntegrityFailure(reader, expectedFailure) {
  await assert.rejects(
    () => reader.listPending({ limit: 10 }),
    (error) => {
      assert.equal(error instanceof NovelOutboxIntegrityError, true);
      assert.equal(error.failure, expectedFailure);
      assert.equal(
        error.message,
        "Novel lifecycle Outbox integrity validation failed",
      );
      return true;
    },
  );
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

const root = await mkdtemp(join(tmpdir(), "novel-outbox-reader-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let canonicalReader;
let draftReader;

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
  const first = recoveryRecord({
    eventId: "outbox-reader:canonical-1",
    novelId: metadata.novelId,
    conversationId: "conversation-outbox-reader",
    occurredAt: "2026-08-02T11:00:00.000Z",
  });
  const second = recoveryRecord({
    eventId: "outbox-reader:canonical-2",
    novelId: metadata.novelId,
    conversationId: "conversation-outbox-reader",
    occurredAt: "2026-08-02T11:01:00.000Z",
  });
  await writer.recordCanonical(second);
  await writer.recordCanonical(first);

  const canonicalDatabase = new DatabaseSync(location.canonicalDatabasePath);
  canonicalDatabase
    .prepare("UPDATE novel_outbox SET attempt_count = 3 WHERE event_id = ?")
    .run(second.eventId);
  canonicalDatabase.close();

  canonicalReader = await SqliteNovelOutboxReader.openCanonical({
    location,
    novelId: metadata.novelId,
    logger,
  });
  const firstPage = await canonicalReader.listPending({ limit: 1 });
  assert.equal(firstPage.entries.length, 1);
  assert.equal(firstPage.entries[0].record.eventId, first.eventId);
  assert.equal(firstPage.entries[0].source.kind, "canonical");
  const secondPage = await canonicalReader.listPending({
    after: firstPage.nextCursor,
    limit: 1,
  });
  assert.equal(secondPage.entries[0].record.eventId, second.eventId);
  assert.equal(secondPage.entries[0].attemptCount, 3);

  const publicationDatabase = new DatabaseSync(location.canonicalDatabasePath);
  publicationDatabase
    .prepare("UPDATE novel_outbox SET published_at = ? WHERE event_id = ?")
    .run("2026-08-02T11:02:00.000Z", first.eventId);
  publicationDatabase.close();
  const unpublished = await canonicalReader.listPending({ limit: 10 });
  assert.deepEqual(
    unpublished.entries.map((entry) => entry.record.eventId),
    [second.eventId],
  );

  const draftSession = captureNovelDraftSession({
    id: captureNovelDraftSessionId("draft-outbox-reader"),
    novelId: metadata.novelId,
    ownerConversationId: "conversation-draft-outbox-reader",
    baseRevision: captureNovelRevision("revision-draft-outbox-reader"),
    status: NOVEL_DRAFT_SESSION_STATUS.active,
    createdAt: captureNovelTimestamp("2026-08-02T11:03:00.000Z"),
    updatedAt: captureNovelTimestamp("2026-08-02T11:03:00.000Z"),
  });
  const draftDatabasePath = join(
    location.stagingDir,
    draftSession.ownerConversationId,
    draftSession.id,
    "draft.sqlite",
  );
  await mkdir(dirname(draftDatabasePath), { recursive: true });
  initializeNovelDraftSqliteSchema(draftDatabasePath, draftSession);
  const draftRecord = recoveryRecord({
    eventId: "outbox-reader:draft-1",
    novelId: metadata.novelId,
    conversationId: draftSession.ownerConversationId,
    occurredAt: "2026-08-02T11:04:00.000Z",
  });
  const draftDatabase = new DatabaseSync(draftDatabasePath);
  insertDraftNovelLifecycleOutboxRecord(draftDatabase, draftRecord);
  draftDatabase.close();

  draftReader = await SqliteNovelOutboxReader.openDraft({
    location,
    session: draftSession,
    logger,
  });
  const draftPage = await draftReader.listPending({ limit: 10 });
  assert.equal(draftPage.entries.length, 1);
  assert.equal(draftPage.entries[0].source.kind, "draft");
  assert.equal(draftPage.entries[0].source.draftSessionId, draftSession.id);
  await draftReader.close();

  const corruptedDigestDatabase = new DatabaseSync(draftDatabasePath);
  corruptedDigestDatabase
    .prepare("UPDATE draft_outbox SET event_digest = ? WHERE event_id = ?")
    .run(`sha256:${"b".repeat(64)}`, draftRecord.eventId);
  corruptedDigestDatabase.close();
  draftReader = await SqliteNovelOutboxReader.openDraft({
    location,
    session: draftSession,
    logger,
  });
  await assertIntegrityFailure(
    draftReader,
    NOVEL_OUTBOX_INTEGRITY_FAILURE.digestMismatch,
  );
  await draftReader.close();

  const corruptedMetadataDatabase = new DatabaseSync(draftDatabasePath);
  const storedJson = corruptedMetadataDatabase
    .prepare("SELECT event_json FROM draft_outbox WHERE event_id = ?")
    .get(draftRecord.eventId).event_json;
  corruptedMetadataDatabase
    .prepare(
      "UPDATE draft_outbox SET event_digest = ?, event_type = ? WHERE event_id = ?",
    )
    .run(
      digestNovelLifecycleOutboxText(storedJson),
      "novel.invalid",
      draftRecord.eventId,
    );
  corruptedMetadataDatabase.close();
  draftReader = await SqliteNovelOutboxReader.openDraft({
    location,
    session: draftSession,
    logger,
  });
  await assertIntegrityFailure(
    draftReader,
    NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
  );
  await draftReader.close();

  const corruptedJsonDatabase = new DatabaseSync(draftDatabasePath);
  const nonCanonicalJson = ` ${storedJson}`;
  corruptedJsonDatabase
    .prepare(
      "UPDATE draft_outbox SET event_type = ?, event_json = ?, event_digest = ? WHERE event_id = ?",
    )
    .run(
      `novel.${draftRecord.eventType}`,
      nonCanonicalJson,
      digestNovelLifecycleOutboxText(nonCanonicalJson),
      draftRecord.eventId,
    );
  corruptedJsonDatabase.close();
  draftReader = await SqliteNovelOutboxReader.openDraft({
    location,
    session: draftSession,
    logger,
  });
  await assertIntegrityFailure(
    draftReader,
    NOVEL_OUTBOX_INTEGRITY_FAILURE.invalidRecord,
  );

  assertRedacted(logs, [root, storedJson, nonCanonicalJson]);
} finally {
  await draftReader?.close();
  await canonicalReader?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel outbox reader smoke passed");
