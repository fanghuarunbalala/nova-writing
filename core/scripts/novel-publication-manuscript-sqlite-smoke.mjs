import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FractionalOrderKeyFactory,
  MANUSCRIPT_ANCHOR_BOUNDARY,
  NovelDraftOperationWriter,
  NovelDraftSessionService,
  NovelOperationExecutor,
  captureManuscript,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelOperationId,
  captureNovelTimestamp,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  createDefaultNovelOperationRegistry,
  createManuscriptBlockSplitOperation,
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
      new Date(Date.UTC(2026, 7, 3, 12, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class DraftIdentityFactory {
  createDraftSessionId() {
    return "draft_publication_manuscript_sqlite";
  }
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

const root = await mkdtemp(join(tmpdir(), "novel-publication-manuscript-"));
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

  const orderKeys = new FractionalOrderKeyFactory();
  const publication = capturePublicationStructure({
    id: capturePublicationStructureId("publication_sqlite"),
    novelId: canonical.novelId,
  });
  const volume = capturePublicationVolume({
    id: capturePublicationVolumeId("volume_sqlite"),
    publicationId: publication.id,
    orderKey: orderKeys.initial(),
    title: "Volume",
  });
  const chapter = capturePublicationChapter({
    id: capturePublicationChapterId("chapter_sqlite"),
    publicationId: publication.id,
    volumeId: volume.id,
    orderKey: orderKeys.initial(),
    title: "Chapter",
  });
  const manuscript = captureManuscript({
    id: captureManuscriptId("manuscript_sqlite"),
    novelId: canonical.novelId,
    publicationId: publication.id,
  });
  const leftBlock = captureParagraphBlock({
    id: captureManuscriptBlockId("block_sqlite_left"),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey: orderKeys.initial(),
    text: "Left and right",
  });
  const rightBlock = captureParagraphBlock({
    id: captureManuscriptBlockId("block_sqlite_right"),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey: orderKeys.after(leftBlock.orderKey),
    text: "right",
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const context = createSqliteNovelMutationContext(database);
      assert.equal(context.publication.insertPublication(publication), true);
      assert.equal(context.publication.insertVolume(volume), true);
      assert.equal(context.publication.insertChapter(chapter), true);
      assert.equal(context.manuscript.insertManuscript(manuscript), true);
      assert.equal(context.manuscript.insertBlock(leftBlock), true);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    const context = createSqliteNovelMutationContext(database);
    assert.deepEqual(context.publication.findPublicationByNovelId(canonical.novelId), publication);
    assert.deepEqual(context.publication.listVolumes(publication.id), [volume]);
    assert.deepEqual(context.publication.listChapters(volume.id), [chapter]);
    assert.deepEqual(context.manuscript.findManuscriptByNovelId(canonical.novelId), manuscript);
    assert.deepEqual(context.manuscript.getBlock(leftBlock.id), leftBlock);
  }, true);

  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
  });
  const clock = new SequenceClock();
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
    }),
    identityFactory: new DraftIdentityFactory(),
    clock,
  });
  const session = await drafts.startDraft("conversation-publication-manuscript");
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

  const expectedTextDigest = withDatabase(
    draftPath,
    (database) => createSqliteNovelMutationContext(database)
      .manuscript.getBlockDigest(leftBlock.id, "text"),
    true,
  );
  const writer = new NovelDraftOperationWriter({
    store: new SqliteNovelDraftOperationStore({
      location,
      novelId: canonical.novelId,
      contextFactory: createSqliteNovelMutationContext,
    }),
    executor: new NovelOperationExecutor(createDefaultNovelOperationRegistry()),
    digester: new NodeSha256NovelOperationDigester(),
    clock,
  });
  await writer.enqueue(session, createManuscriptBlockSplitOperation({
    operationId: captureNovelOperationId("manuscript_split_sqlite"),
    blockId: leftBlock.id,
    expectedTextDigest,
    leftText: "Left",
    rightBlock,
  }));

  withDatabase(draftPath, (database) => {
    const repository = createSqliteNovelMutationContext(database).manuscript;
    assert.equal(repository.getBlock(leftBlock.id).text, "Left");
    assert.deepEqual(repository.getBlock(rightBlock.id), rightBlock);
    assert.deepEqual(repository.getAnchorRedirect({
      blockId: leftBlock.id,
      boundary: MANUSCRIPT_ANCHOR_BOUNDARY.after,
    }), {
      source: {
        blockId: leftBlock.id,
        boundary: MANUSCRIPT_ANCHOR_BOUNDARY.after,
      },
      target: {
        blockId: rightBlock.id,
        boundary: MANUSCRIPT_ANCHOR_BOUNDARY.after,
      },
      reason: "split",
      review: "automatic",
    });
  }, true);

  withDatabase(location.canonicalDatabasePath, (database) => {
    const repository = createSqliteNovelMutationContext(database).manuscript;
    assert.deepEqual(repository.getBlock(leftBlock.id), leftBlock);
    assert.equal(repository.getBlock(rightBlock.id), undefined);
  }, true);

  console.log("novel publication manuscript SQLite smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
