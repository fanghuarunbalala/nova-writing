import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NovelDraftAlreadyActiveError,
  NovelDraftRecoveryService,
  NovelDraftSessionService,
  NovelProtocolValidationError,
  NovelSnapshotError,
  captureNovelDraftRecoveryResult,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelSnapshotter,
} from "../dist/node/index.js";

class SequentialIdentityFactory {
  constructor(ids) {
    this.ids = [...ids];
  }
  createDraftSessionId() {
    return captureNovelDraftSessionId(this.ids.shift());
  }
}

class SequenceClock {
  constructor() {
    this.offset = 0;
  }
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 1, 0, 0, this.offset++)).toISOString(),
    );
  }
}

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

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function draftPath(location, session) {
  return join(
    location.stagingDir,
    session.ownerConversationId,
    session.id,
    "draft.sqlite",
  );
}

function assertRedacted(entries, forbidden) {
  const serialized = JSON.stringify(entries);
  for (const value of forbidden) assert.equal(serialized.includes(value), false);
  for (const entry of entries) {
    for (const field of ["path", "sql", "payload", "message", "stack", "cause"]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-draft-session-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, logger });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  const lifecycleWriter = new SqliteNovelLifecycleRecordWriter(
    location,
    canonical.novelId,
  );
  const service = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new SequentialIdentityFactory([
      "draft_conversation_a",
      "draft_conversation_b",
      "draft_interrupted_reset",
      "draft_unproven_mismatch",
    ]),
    clock,
    lifecycleWriter,
    logger,
  });

  const [draftA, draftB, interruptedResetDraft, unprovenMismatchDraft] =
    await Promise.all([
      service.startDraft("conversation-a"),
      service.startDraft("conversation-b"),
      service.startDraft("conversation-c"),
      service.startDraft("conversation-d"),
    ]);
  assert.notEqual(draftA.id, draftB.id);
  assert.equal(draftA.baseRevision, canonical.currentRevision);
  assert.equal(await exists(draftPath(location, draftA)), true);
  assert.equal(await exists(draftPath(location, draftB)), true);
  await assert.rejects(
    () => service.startDraft("conversation-a"),
    NovelDraftAlreadyActiveError,
  );
  assert.equal((await service.getActiveDraft("conversation-a")).id, draftA.id);

  await draftStore.close();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const resolvedCandidatesForRecovery = [];
  const recovery = new NovelDraftRecoveryService({
    canonicalStore,
    draftStore,
    snapshotter,
    resolvedRebaseCandidateStore: {
      async listResolvedCandidates(novelId) {
        assert.equal(novelId, canonical.novelId);
        return resolvedCandidatesForRecovery;
      },
    },
    clock,
    lifecycleWriter,
    logger,
  });
  const restarted = await recovery.recoverDraftSessions();
  assert.deepEqual(restarted.recoveredDraftSessionIds, [
    draftA.id,
    draftB.id,
    interruptedResetDraft.id,
    unprovenMismatchDraft.id,
  ]);
  const duplicateRecovery = await recovery.recoverDraftSessions();
  assert.deepEqual(duplicateRecovery.recoveredDraftSessionIds, restarted.recoveredDraftSessionIds);
  const recoveryEventDatabase = new DatabaseSync(location.canonicalDatabasePath, { readOnly: true });
  const recoveryEvents = recoveryEventDatabase.prepare(
    "SELECT event_id, conversation_id, event_json FROM novel_outbox WHERE event_type = 'novel.recovery.completed'",
  ).all();
  recoveryEventDatabase.close();
  assert.equal(
    recoveryEvents.filter((row) => row.event_id === `draft-recovery:${draftA.id}`).length,
    1,
  );
  assert.equal(
    recoveryEvents.find((row) => row.event_id === `draft-recovery:${draftA.id}`).conversation_id,
    draftA.ownerConversationId,
  );

  const canonicalDatabase = new DatabaseSync(location.canonicalDatabasePath);
  canonicalDatabase.exec("CREATE TABLE reset_marker(value TEXT NOT NULL) STRICT");
  canonicalDatabase.prepare("INSERT INTO reset_marker(value) VALUES (?)").run("latest");
  canonicalDatabase
    .prepare(
      "UPDATE novel_metadata SET current_revision = ?, updated_at = ? WHERE singleton = 1",
    )
    .run("revision_after_reset", "2026-08-02T01:30:00.000Z");
  canonicalDatabase.close();

  await snapshotter.replaceDraftSnapshot({
    session: captureNovelDraftSession({
      ...interruptedResetDraft,
      baseRevision: captureNovelRevision("revision_after_reset"),
      updatedAt: clock.now(),
    }),
    expectedBaseRevision: interruptedResetDraft.baseRevision,
  });
  const recoveredReset = await recovery.recoverDraftSessions();
  assert.deepEqual(recoveredReset.recoveredDraftSessionIds, [
    draftA.id,
    draftB.id,
    interruptedResetDraft.id,
    unprovenMismatchDraft.id,
  ]);
  assert.equal(
    (
      await draftStore.getDraftSession(
        interruptedResetDraft.novelId,
        interruptedResetDraft.id,
      )
    ).baseRevision,
    "revision_after_reset",
  );

  const mismatchRecovery = new NovelDraftRecoveryService({
    canonicalStore,
    draftStore,
    snapshotter: {
      ...snapshotter,
      inspectDraftSnapshot: async (novelId, draftSessionId) => {
        const inspected = await snapshotter.inspectDraftSnapshot(
          novelId,
          draftSessionId,
        );
        return draftSessionId === unprovenMismatchDraft.id && inspected
          ? Object.freeze({
              ...inspected,
              baseRevision: captureNovelRevision("unproven_revision"),
            })
          : inspected;
      },
      listDraftSnapshotIds: (novelId) =>
        snapshotter.listDraftSnapshotIds(novelId),
      removeDraftSnapshot: (novelId, draftSessionId) =>
        snapshotter.removeDraftSnapshot(novelId, draftSessionId),
    },
    clock,
    lifecycleWriter,
    logger,
  });
  const rejectedMismatch = await mismatchRecovery.recoverDraftSessions();
  assert.deepEqual(rejectedMismatch.rolledBackDraftSessionIds, [
    unprovenMismatchDraft.id,
  ]);

  const resumedService = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new SequentialIdentityFactory(["draft_unused"]),
    clock,
    logger,
  });
  const resetDraft = await resumedService.resetToMain(draftA.id);
  assert.equal(resetDraft.id, draftA.id);
  assert.equal(resetDraft.baseRevision, "revision_after_reset");
  const resetDatabase = new DatabaseSync(draftPath(location, draftA), { readOnly: true });
  assert.equal(resetDatabase.prepare("SELECT value FROM reset_marker").get().value, "latest");
  resetDatabase.close();

  const rolledBack = await resumedService.rollback(draftB.id);
  assert.equal(rolledBack.status, NOVEL_DRAFT_SESSION_STATUS.rolledBack);
  assert.equal(await exists(draftPath(location, draftB)), false);
  assert.equal(await resumedService.getActiveDraft("conversation-b"), undefined);
  const lifecycleDatabase = new DatabaseSync(location.canonicalDatabasePath, {
    readOnly: true,
  });
  const lifecycleRows = lifecycleDatabase
    .prepare(
      `SELECT event_id, conversation_id, event_type, event_json, event_digest
       FROM novel_outbox ORDER BY created_at, event_id`,
    )
    .all();
  lifecycleDatabase.close();
  const startedRow = lifecycleRows.find(
    (row) => row.event_id === `draft-started:${draftA.id}`,
  );
  const rolledBackRow = lifecycleRows.find(
    (row) => row.event_id === `draft-rolled-back:${draftB.id}`,
  );
  assert.equal(startedRow.event_type, "novel.draft.started");
  assert.equal(startedRow.conversation_id, draftA.ownerConversationId);
  assert.equal(JSON.parse(startedRow.event_json).eventType, "draft.started");
  assert.equal(rolledBackRow.event_type, "novel.draft.rolled.back");
  assert.equal(JSON.parse(rolledBackRow.event_json).eventType, "draft.rolled.back");
  assert.match(startedRow.event_digest, /^sha256:[0-9a-f]{64}$/u);

  const orphan = captureNovelDraftSession({
    id: captureNovelDraftSessionId("draft_orphan"),
    novelId: canonical.novelId,
    ownerConversationId: "conversation-orphan",
    baseRevision: captureNovelRevision("revision_after_reset"),
    status: NOVEL_DRAFT_SESSION_STATUS.active,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
  await snapshotter.createDraftSnapshot(orphan);
  const retainedResolvedCandidate = captureNovelDraftSession({
    id: captureNovelDraftSessionId("draft_resolved_candidate"),
    novelId: canonical.novelId,
    ownerConversationId: resetDraft.ownerConversationId,
    baseRevision: resetDraft.baseRevision,
    status: NOVEL_DRAFT_SESSION_STATUS.rebasing,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
  await snapshotter.createRebaseCandidateSnapshot({
    session: retainedResolvedCandidate,
    sourceDraftSessionId: resetDraft.id,
  });
  resolvedCandidatesForRecovery.push({ session: retainedResolvedCandidate });
  await writeFile(
    join(
      location.stagingDir,
      orphan.ownerConversationId,
      orphan.id,
      "manifest.json",
    ),
    "invalid-manifest\n",
    "utf8",
  );
  await snapshotter.removeDraftSnapshot(resetDraft.novelId, resetDraft.id);
  const reconciled = await recovery.recoverDraftSessions();
  assert.deepEqual(reconciled.rolledBackDraftSessionIds, [resetDraft.id]);
  assert.deepEqual(reconciled.removedOrphanSnapshotIds, [orphan.id]);
  assert.equal(await exists(draftPath(location, orphan)), false);
  assert.equal(await exists(draftPath(location, retainedResolvedCandidate)), true);

  const failingService = new NovelDraftSessionService({
    canonicalStore: {
      async getMetadata() {
        return Object.freeze({
          ...(await canonicalStore.getMetadata()),
          currentRevision: captureNovelRevision("revision_stale_for_failure"),
        });
      },
      async close() {},
    },
    draftStore,
    snapshotter,
    identityFactory: new SequentialIdentityFactory(["draft_failed_snapshot"]),
    clock,
    logger,
  });
  await assert.rejects(
    () => failingService.startDraft("conversation-failure"),
    NovelSnapshotError,
  );
  assert.equal(
    await exists(
      join(location.stagingDir, "conversation-failure", "draft_failed_snapshot"),
    ),
    false,
  );

  assert.throws(
    () =>
      captureNovelDraftRecoveryResult({
        recoveredDraftSessionIds: [draftA.id],
        resetDraftSessionIds: [],
        rolledBackDraftSessionIds: [draftA.id],
        retainedTerminalSnapshotIds: [],
        removedCandidateSnapshotIds: [],
        removedOrphanSnapshotIds: [],
      }),
    NovelProtocolValidationError,
  );

  assertRedacted(logs, [root, "latest", "revision_stale_for_failure", "CREATE TABLE"]);
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel draft session smoke passed");
