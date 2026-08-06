import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NOVEL_PROJECTION_FRESHNESS,
  NOVEL_PROJECTION_TARGET_KIND,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureStoryUnitId,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelProjectionStore,
  SqliteNovelSnapshotter,
} from "../dist/node/index.js";

class Clock {
  constructor() { this.offset = 0; }
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 1, 0, 0, this.offset++)).toISOString(),
    );
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-projection-sqlite-"));
let canonicalStore;
try {
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  const clock = new Clock();
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, clock });
  const metadata = await canonicalStore.getMetadata();
  const canonical = new SqliteNovelProjectionStore({
    location,
    novelId: metadata.novelId,
    scope: { kind: "canonical" },
    clock,
  });
  const target = conformanceTarget("story_projection_sqlite");
  const entry = conformanceEntry(target, metadata.currentRevision);
  await canonical.putEntry({
    novelId: metadata.novelId,
    rebuildRevision: metadata.currentRevision,
    entry,
  });
  assert.deepEqual(await canonical.getEntry(metadata.novelId, target), entry);
  assert.deepEqual(await canonical.inspectTargets(metadata.novelId), {
    storedCount: 1,
    corruptCount: 0,
    targets: [target],
  });

  const database = new DatabaseSync(location.canonicalDatabasePath);
  database.prepare(
    `INSERT INTO novel_projection_cache(
       projection_key, target_json, projection_json, projection_digest,
       rebuild_revision, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "{invalid",
    "{}",
    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    metadata.currentRevision,
    clock.now(),
  );
  database.close();
  assert.deepEqual(await canonical.inspectTargets(metadata.novelId), {
    storedCount: 2,
    corruptCount: 1,
    targets: [target],
  });

  const replacementTarget = conformanceTarget("story_projection_replacement");
  const replacementEntry = conformanceEntry(
    replacementTarget,
    metadata.currentRevision,
  );
  await canonical.replaceCache({
    novelId: metadata.novelId,
    rebuildRevision: metadata.currentRevision,
    entries: [replacementEntry],
  });
  assert.equal(await canonical.getEntry(metadata.novelId, target), undefined);
  assert.deepEqual(
    await canonical.getEntry(metadata.novelId, replacementTarget),
    replacementEntry,
  );

  const failingDatabase = new DatabaseSync(location.canonicalDatabasePath);
  failingDatabase.exec(`
    CREATE TRIGGER projection_replace_abort
    BEFORE INSERT ON novel_projection_cache
    WHEN NEW.target_json LIKE '%story_projection_abort%'
    BEGIN
      SELECT RAISE(ABORT, 'projection replacement aborted');
    END;
  `);
  failingDatabase.close();
  await assert.rejects(
    canonical.replaceCache({
      novelId: metadata.novelId,
      rebuildRevision: metadata.currentRevision,
      entries: [conformanceEntry(
        conformanceTarget("story_projection_abort"),
        metadata.currentRevision,
      )],
    }),
  );
  assert.deepEqual(
    await canonical.getEntry(metadata.novelId, replacementTarget),
    replacementEntry,
  );

  const session = captureNovelDraftSession({
    id: captureNovelDraftSessionId("draft_projection_sqlite"),
    novelId: metadata.novelId,
    ownerConversationId: "conversation-projection-sqlite",
    baseRevision: metadata.currentRevision,
    status: NOVEL_DRAFT_SESSION_STATUS.active,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: metadata.novelId,
  });
  await snapshotter.createDraftSnapshot(session);
  const draft = new SqliteNovelProjectionStore({
    location,
    novelId: metadata.novelId,
    scope: { kind: "draft", session },
    clock,
  });
  await draft.putEntry({
    novelId: metadata.novelId,
    rebuildRevision: metadata.currentRevision,
    entry,
  });
  const reopenedDraft = new SqliteNovelProjectionStore({
    location,
    novelId: metadata.novelId,
    scope: { kind: "draft", session },
    clock,
  });
  assert.deepEqual(await reopenedDraft.getEntry(metadata.novelId, target), entry);
  await reopenedDraft.deleteEntry(metadata.novelId, target);
  assert.equal(await reopenedDraft.getEntry(metadata.novelId, target), undefined);
} finally {
  await canonicalStore?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

function conformanceTarget(id) {
  return Object.freeze({
    kind: NOVEL_PROJECTION_TARGET_KIND.storyUnitConformance,
    storyUnitId: captureStoryUnitId(id),
  });
}

function conformanceEntry(target, sourceRevision) {
  return Object.freeze({
    target,
    projection: Object.freeze({
      storyUnitId: target.storyUnitId,
      sourceRevision: captureNovelRevision(sourceRevision),
      freshness: NOVEL_PROJECTION_FRESHNESS.current,
      validationStatus: "pending",
      warningCount: 0,
      errorCount: 0,
      evidenceStoryUnitIds: Object.freeze([target.storyUnitId]),
    }),
  });
}

console.log("novel projection sqlite smoke passed");
