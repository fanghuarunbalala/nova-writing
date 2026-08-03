import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FractionalOrderKeyFactory,
  NovelDraftOperationWriter,
  NovelDraftSessionService,
  NovelOperationExecutor,
  STORY_SETTING_MODE,
  captureLeafStoryUnitPlan,
  captureNovelOperationId,
  captureNovelTimestamp,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createDefaultNovelOperationRegistry,
  createLeafStoryUnitPlanReplaceOperation,
  createStoryOutlineCreateOperation,
  createStoryUnitCreateOperation,
  createStoryUnitMoveOperation,
  createStoryUnitReplaceOperation,
} from "../dist/index.js";
import {
  LATEST_NOVEL_DRAFT_SCHEMA_VERSION,
  LATEST_NOVEL_SCHEMA_VERSION,
  NodeNovelStoreLocator,
  NodeSha256NovelOperationDigester,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createSqliteNovelMutationContext,
} from "../dist/node/index.js";

class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 8, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class DraftIdentityFactory {
  createDraftSessionId() {
    return "draft_outline_sqlite";
  }
}

let operationSequence = 0;
function operationId(label) {
  operationSequence += 1;
  return captureNovelOperationId(`${label}_${operationSequence}`);
}

function withDatabase(path, callback, readOnly = false) {
  const database = new DatabaseSync(path, { readOnly });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    return callback(database);
  } finally {
    database.close();
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-outline-sqlite-"));
const workspaceRoot = join(root, "workspace");
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location });
  const canonical = await canonicalStore.getMetadata();
  assert.equal(canonical.schemaVersion, LATEST_NOVEL_SCHEMA_VERSION);

  const executor = new NovelOperationExecutor(createDefaultNovelOperationRegistry());
  const orderKeys = new FractionalOrderKeyFactory();
  const outlineId = captureStoryOutlineId("outline_sqlite");
  const rootId = captureStoryUnitId("story_unit_sqlite_root");
  const leafId = captureStoryUnitId("story_unit_sqlite_leaf");
  const outline = captureStoryOutline({ id: outlineId, novelId: canonical.novelId });
  const rootUnit = captureStoryUnit({
    id: rootId,
    outlineId,
    orderKey: orderKeys.initial(),
    title: "SQLite root",
    planningStatus: "outlined",
    realizationStatus: "pending",
  });
  const leafUnit = captureStoryUnit({
    id: leafId,
    outlineId,
    parentId: rootId,
    orderKey: orderKeys.initial(),
    title: "SQLite leaf",
    planningStatus: "outlined",
    realizationStatus: "pending",
  });
  const plan = captureLeafStoryUnitPlan({
    storyUnitId: leafId,
    settingMode: STORY_SETTING_MODE.locationIndependent,
    characters: [],
    locations: [],
    events: [],
    rhythmBeats: [],
    entityChanges: [],
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const context = createSqliteNovelMutationContext(database);
      for (const operation of [
        createStoryOutlineCreateOperation({
          operationId: operationId("canonical_outline"),
          outline,
        }),
        createStoryUnitCreateOperation({
          operationId: operationId("canonical_root"),
          storyUnit: rootUnit,
        }),
        createStoryUnitCreateOperation({
          operationId: operationId("canonical_leaf"),
          storyUnit: leafUnit,
        }),
        createLeafStoryUnitPlanReplaceOperation({
          operationId: operationId("canonical_plan"),
          plan,
        }),
      ]) {
        executor.executeSynchronous(context, operation);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    const repository = createSqliteNovelMutationContext(database).outline;
    assert.deepEqual(repository.getOutline(outlineId), outline);
    assert.deepEqual(repository.getStoryUnit(leafId), leafUnit);
    assert.deepEqual(repository.getLeafStoryUnitPlan(leafId), plan);
    assert.equal(repository.listStoryUnitChildren(rootId).length, 1);
  }, true);

  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
  });
  const clock = new SequenceClock();
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
  });
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new DraftIdentityFactory(),
    clock,
  });
  const session = await drafts.startDraft("conversation-outline-sqlite");
  const draftPath = join(
    location.stagingDir,
    session.ownerConversationId,
    session.id,
    "draft.sqlite",
  );
  assert.equal(
    withDatabase(
      draftPath,
      (database) => database
        .prepare("SELECT schema_version FROM draft_metadata WHERE singleton = 1")
        .get().schema_version,
      true,
    ),
    LATEST_NOVEL_DRAFT_SCHEMA_VERSION,
  );

  function createWriter() {
    return new NovelDraftOperationWriter({
      store: new SqliteNovelDraftOperationStore({
        location,
        novelId: canonical.novelId,
        contextFactory: createSqliteNovelMutationContext,
      }),
      executor,
      digester: new NodeSha256NovelOperationDigester(),
      clock,
    });
  }

  const draftDigest = (field) => withDatabase(
    draftPath,
    (database) => createSqliteNovelMutationContext(database)
      .outline.getStoryUnitDigest(leafId, field),
    true,
  );
  await createWriter().enqueue(session, createStoryUnitReplaceOperation({
    operationId: operationId("draft_replace"),
    storyUnitId: leafId,
    expectedContentDigest: draftDigest("content"),
    content: {
      title: "SQLite leaf revised",
      planningStatus: "ready",
      realizationStatus: "in-progress",
    },
  }));

  await createWriter().enqueue(session, createStoryUnitMoveOperation({
    operationId: operationId("draft_move"),
    storyUnitId: leafId,
    expectedParentDigest: draftDigest("parentId"),
    expectedOrderDigest: draftDigest("orderKey"),
    orderKey: orderKeys.after(rootUnit.orderKey),
  }));

  withDatabase(draftPath, (database) => {
    const repository = createSqliteNovelMutationContext(database).outline;
    const leaf = repository.getStoryUnit(leafId);
    assert.equal(leaf.title, "SQLite leaf revised");
    assert.equal(leaf.parentId, undefined);
    assert.deepEqual(repository.getLeafStoryUnitPlan(leafId), plan);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM draft_operations").get().count,
      2,
    );
  }, true);

  withDatabase(location.canonicalDatabasePath, (database) => {
    const canonicalLeaf = createSqliteNovelMutationContext(database)
      .outline.getStoryUnit(leafId);
    assert.equal(canonicalLeaf.title, "SQLite leaf");
    assert.equal(canonicalLeaf.parentId, rootId);
  }, true);

  console.log("novel outline SQLite smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
