import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_OUTBOX_ATTEMPT_STATUS,
  NOVEL_OUTBOX_INTEGRITY_FAILURE,
  NOVEL_OUTBOX_PUBLICATION_STATUS,
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
  SqliteNovelOutboxStore,
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

function lifecycleRecord({ eventId, novelId, conversationId, occurredAt }) {
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

async function expectIntegrityFailure(action, expectedFailure) {
  await assert.rejects(action, (error) => {
    assert.equal(error instanceof NovelOutboxIntegrityError, true);
    assert.equal(error.failure, expectedFailure);
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

const root = await mkdtemp(join(tmpdir(), "novel-outbox-store-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let outboxStore;
let draftOutboxStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, logger });
  const metadata = await canonicalStore.getMetadata();
  const lifecycleWriter = new SqliteNovelLifecycleRecordWriter(
    location,
    metadata.novelId,
  );
  const canonicalRecord = lifecycleRecord({
    eventId: "outbox-store:canonical",
    novelId: metadata.novelId,
    conversationId: "conversation-outbox-store",
    occurredAt: "2026-08-02T12:00:00.000Z",
  });
  await lifecycleWriter.recordCanonical(canonicalRecord);

  outboxStore = await SqliteNovelOutboxStore.openCanonical({
    location,
    novelId: metadata.novelId,
    logger,
  });
  const page = await outboxStore.listPending({ limit: 10 });
  const entry = page.entries.find(
    (value) => value.record.eventId === canonicalRecord.eventId,
  );
  assert.notEqual(entry, undefined);
  const identity = {
    source: entry.source,
    novelId: entry.record.novelId,
    eventId: entry.record.eventId,
    recordDigest: entry.recordDigest,
  };

  assert.deepEqual(await outboxStore.recordAttempt(identity), {
    status: NOVEL_OUTBOX_ATTEMPT_STATUS.recorded,
    attemptCount: 1,
  });
  assert.deepEqual(await outboxStore.recordAttempt(identity), {
    status: NOVEL_OUTBOX_ATTEMPT_STATUS.recorded,
    attemptCount: 2,
  });
  assert.equal(
    (await outboxStore.listPending({ limit: 10 })).entries[0].attemptCount,
    2,
  );

  await expectIntegrityFailure(
    () =>
      outboxStore.recordAttempt({
        ...identity,
        recordDigest: `sha256:${"b".repeat(64)}`,
      }),
    NOVEL_OUTBOX_INTEGRITY_FAILURE.digestMismatch,
  );
  await expectIntegrityFailure(
    () =>
      outboxStore.recordAttempt({
        ...identity,
        source: {
          kind: "draft",
          draftSessionId: captureNovelDraftSessionId("wrong-draft"),
        },
      }),
    NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
  );
  assert.deepEqual(
    await outboxStore.recordAttempt({
      ...identity,
      eventId: "outbox-store:missing",
    }),
    { status: NOVEL_OUTBOX_ATTEMPT_STATUS.missing },
  );

  const publishedAt = captureNovelTimestamp("2026-08-02T12:01:00.000Z");
  assert.deepEqual(
    await outboxStore.markPublished({ ...identity, publishedAt }),
    {
      status: NOVEL_OUTBOX_PUBLICATION_STATUS.published,
      publishedAt,
    },
  );
  assert.deepEqual(
    await outboxStore.markPublished({
      ...identity,
      publishedAt: captureNovelTimestamp("2026-08-02T12:02:00.000Z"),
    }),
    {
      status: NOVEL_OUTBOX_PUBLICATION_STATUS.alreadyPublished,
      publishedAt,
    },
  );
  assert.deepEqual(await outboxStore.recordAttempt(identity), {
    status: NOVEL_OUTBOX_ATTEMPT_STATUS.alreadyPublished,
    attemptCount: 2,
  });
  assert.equal((await outboxStore.listPending({ limit: 10 })).entries.length, 0);

  await outboxStore.close();
  outboxStore = await SqliteNovelOutboxStore.openCanonical({
    location,
    novelId: metadata.novelId,
    logger,
  });
  assert.deepEqual(
    await outboxStore.markPublished({
      ...identity,
      publishedAt: captureNovelTimestamp("2026-08-02T12:03:00.000Z"),
    }),
    {
      status: NOVEL_OUTBOX_PUBLICATION_STATUS.alreadyPublished,
      publishedAt,
    },
  );

  const draftSession = captureNovelDraftSession({
    id: captureNovelDraftSessionId("draft-outbox-store"),
    novelId: metadata.novelId,
    ownerConversationId: "conversation-draft-outbox-store",
    baseRevision: captureNovelRevision("revision-draft-outbox-store"),
    status: NOVEL_DRAFT_SESSION_STATUS.active,
    createdAt: captureNovelTimestamp("2026-08-02T12:04:00.000Z"),
    updatedAt: captureNovelTimestamp("2026-08-02T12:04:00.000Z"),
  });
  const draftDatabasePath = join(
    location.stagingDir,
    draftSession.ownerConversationId,
    draftSession.id,
    "draft.sqlite",
  );
  await mkdir(dirname(draftDatabasePath), { recursive: true });
  initializeNovelDraftSqliteSchema(draftDatabasePath, draftSession);
  const draftRecord = lifecycleRecord({
    eventId: "outbox-store:draft",
    novelId: metadata.novelId,
    conversationId: draftSession.ownerConversationId,
    occurredAt: "2026-08-02T12:05:00.000Z",
  });
  const draftDatabase = new DatabaseSync(draftDatabasePath);
  insertDraftNovelLifecycleOutboxRecord(draftDatabase, draftRecord);
  draftDatabase.close();

  draftOutboxStore = await SqliteNovelOutboxStore.openDraft({
    location,
    session: draftSession,
    logger,
  });
  const draftEntry = (await draftOutboxStore.listPending({ limit: 10 }))
    .entries[0];
  const draftIdentity = {
    source: draftEntry.source,
    novelId: draftEntry.record.novelId,
    eventId: draftEntry.record.eventId,
    recordDigest: draftEntry.recordDigest,
  };
  assert.deepEqual(await draftOutboxStore.recordAttempt(draftIdentity), {
    status: NOVEL_OUTBOX_ATTEMPT_STATUS.recorded,
    attemptCount: 1,
  });
  assert.deepEqual(
    await draftOutboxStore.markPublished({
      ...draftIdentity,
      publishedAt: captureNovelTimestamp("2026-08-02T12:06:00.000Z"),
    }),
    {
      status: NOVEL_OUTBOX_PUBLICATION_STATUS.published,
      publishedAt: captureNovelTimestamp("2026-08-02T12:06:00.000Z"),
    },
  );

  assertRedacted(logs, [root, JSON.stringify(canonicalRecord), JSON.stringify(draftRecord)]);
} finally {
  await draftOutboxStore?.close();
  await outboxStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel outbox store smoke passed");
