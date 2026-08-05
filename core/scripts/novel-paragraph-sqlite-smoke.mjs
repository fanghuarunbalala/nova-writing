import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  captureNovelId,
  captureNovelTimestamp,
  captureParagraph,
  captureParagraphId,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
} from "../dist/index.js";
import {
  LATEST_NOVEL_SCHEMA_VERSION,
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  createSqliteNovelMutationContext,
} from "../dist/node/index.js";
import { DatabaseSync } from "node:sqlite";

function withDatabase(path, callback) {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    return callback(database);
  } finally {
    database.close();
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-paragraph-sqlite-"));
const workspaceRoot = join(root, "workspace");
let canonicalStore;

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
  const first = orderKeys.initial();
  const second = orderKeys.after(first);
  const outlineId = captureStoryOutlineId("outline_paragraph_sqlite");
  const storyUnitId = captureStoryUnitId("story_unit_paragraph_sqlite");
  const publication = capturePublicationStructure({
    id: capturePublicationStructureId("publication_sqlite"),
    novelId: canonical.novelId,
  });
  const volume = capturePublicationVolume({
    id: capturePublicationVolumeId("volume_sqlite"),
    publicationId: publication.id,
    orderKey: first,
    title: "Volume",
  });
  const chapter = capturePublicationChapter({
    id: capturePublicationChapterId("chapter_sqlite"),
    publicationId: publication.id,
    volumeId: volume.id,
    orderKey: first,
    title: "Chapter",
    paragraphIds: [],
  });
  const paragraphOne = captureParagraph({
    id: captureParagraphId("paragraph_sqlite_one"),
    storyUnitId,
    orderKey: first,
    text: "One",
  });
  const paragraphTwo = captureParagraph({
    id: captureParagraphId("paragraph_sqlite_two"),
    storyUnitId,
    orderKey: second,
    text: "Two",
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const context = createSqliteNovelMutationContext(database);
      context.outline.insertOutline({
        id: outlineId,
        novelId: captureNovelId(canonical.novelId),
      });
      context.outline.insertStoryUnit(captureStoryUnit({
        id: storyUnitId,
        outlineId,
        orderKey: first,
        title: "Leaf",
        planningStatus: "ready",
        realizationStatus: "pending",
      }));
      context.publication.insertPublication(publication);
      context.publication.insertVolume(volume);
      context.publication.insertChapter(chapter);
      context.paragraph.insertParagraph(paragraphOne);
      context.paragraph.insertParagraph(paragraphTwo);
      assert.equal(context.paragraph.listParagraphsByStoryUnit(storyUnitId).length, 2);
      assert.equal(context.paragraph.listAllParagraphs().length, 2);
      assert.equal(
        context.paragraph.getParagraphDigest(paragraphOne.id, "text").length,
        64,
      );
      assert.equal(
        context.paragraph.getParagraphDigest(paragraphOne.id, "storyUnitId").length,
        64,
      );

      assert.equal(context.publication.hasParagraph(paragraphOne.id), true);
      assert.equal(
        context.publication.getChapterIdByParagraphId(paragraphOne.id),
        undefined,
      );
      assert.equal(
        context.publication.setChapterParagraphIds(chapter.id, [paragraphOne.id, paragraphTwo.id]),
        true,
      );
      assert.deepEqual(context.publication.listChapterParagraphIds(chapter.id), [
        paragraphOne.id,
        paragraphTwo.id,
      ]);
      assert.equal(
        context.publication.getChapterIdByParagraphId(paragraphOne.id),
        chapter.id,
      );
      const chapterRead = context.publication.getChapter(chapter.id);
      assert.deepEqual(chapterRead.paragraphIds, [paragraphOne.id, paragraphTwo.id]);
      assert.equal(chapterRead.volumeId, volume.id);

      assert.equal(context.paragraph.removeParagraphFromChapters(paragraphOne.id), true);
      assert.deepEqual(context.publication.listChapterParagraphIds(chapter.id), [
        paragraphTwo.id,
      ]);
      assert.equal(
        context.publication.getChapterIdByParagraphId(paragraphOne.id),
        undefined,
      );
      assert.equal(context.paragraph.deleteParagraph(paragraphOne.id), true);
      assert.equal(context.paragraph.getParagraph(paragraphOne.id), undefined);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  console.log("novel paragraph sqlite smoke passed");
} finally {
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
