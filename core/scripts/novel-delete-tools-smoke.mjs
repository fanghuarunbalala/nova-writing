import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  NovelDeleteToolService,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLocationId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraph,
  captureParagraphId,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createCharacterCreateOperation,
  createLocationCreateOperation,
  createNovelDeleteToolRegistry,
  createParagraphCreateOperation,
  createPublicationChapterCreateOperation,
  createPublicationCreateOperation,
  createPublicationVolumeCreateOperation,
  createStoryOutlineCreateOperation,
  createStoryUnitCreateOperation,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  createNodeNovelApplication,
} from "../dist/node/index.js";

class FixedRevisionFactory {
  constructor(value) {
    this.value = captureNovelRevision(value);
  }
  createRevision() {
    return this.value;
  }
}

class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 6, 11, 0, 0, this.offset++)).toISOString(),
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

const root = await mkdtemp(join(tmpdir(), "novel-delete-tools-"));
const logs = [];
const logger = new CollectingLogger(logs);

const context = (conversationId, index) => ({
  conversationId,
  runId: `run_${conversationId}_${index}`,
  toolCallId: `call_${conversationId}_${index}`,
  signal: new AbortController().signal,
});
const progress = { async emit() {} };
let canonicalStore;

try {
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_delete_tools_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  const clock = new SequenceClock();
  let operationSequence = 0;
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  const service = new NovelDeleteToolService({
    outlineQueries: application.outlineQueries,
    characterQueries: application.characterQueries,
    locationQueries: application.locationQueries,
    paragraphQueries: application.paragraphQueries,
    publicationQueries: application.publicationQueries,
    canonicalWrites: application.canonicalWrites,
    identityFactory: {
      createOperationId: () =>
        captureNovelOperationId(`delete_tool_operation_${++operationSequence}`),
    },
    logger,
  });
  const registry = createNovelDeleteToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    ["NovelDelete"],
  );
  assert.deepEqual(NOVEL_DELETE_TOOL_GROUP_MANIFEST.tools, ["NovelDelete"]);

  const conversation = "conversation_delete_tools";
  const outlineId = captureStoryOutlineId("outline_delete_tools");
  const parentId = captureStoryUnitId("story_unit_parent_delete");
  const leafId = captureStoryUnitId("story_unit_leaf_delete");
  const characterId = captureCharacterId("character_delete");
  const locationId = captureLocationId("location_delete");
  const paragraphId = captureParagraphId("paragraph_delete");
  const volumeId = capturePublicationVolumeId("volume_delete");
  const chapterId = capturePublicationChapterId("chapter_delete");
  const publicationId = capturePublicationStructureId("publication_delete");
  const guardVolumeId = capturePublicationVolumeId("volume_guard");
  const guardChapterId = capturePublicationChapterId("chapter_guard");
  const guardedStoryUnitId = captureStoryUnitId("story_unit_guard_para");
  const guardParagraphId = captureParagraphId("paragraph_guard");

  await application.canonicalWrites.applyOperations({
    operations: [
      createStoryOutlineCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        outline: captureStoryOutline({ id: outlineId, novelId: canonical.novelId }),
      }),
      createStoryUnitCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        storyUnit: captureStoryUnit({
          id: parentId,
          outlineId,
          orderKey: "8000",
          title: "Parent",
          planningStatus: "outlined",
          realizationStatus: "pending",
        }),
      }),
      createStoryUnitCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        storyUnit: captureStoryUnit({
          id: leafId,
          outlineId,
          parentId,
          orderKey: "8000",
          title: "Leaf",
          planningStatus: "ready",
          realizationStatus: "in-progress",
        }),
      }),
      createCharacterCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        id: characterId,
        profile: { name: "Delete Me", aliases: [] },
        timestamp: clock.now(),
      }),
      createLocationCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        id: locationId,
        profile: { name: "Delete Place", aliases: [] },
        timestamp: clock.now(),
      }),
      createParagraphCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        paragraph: captureParagraph({
          id: paragraphId,
          storyUnitId: leafId,
          orderKey: "8000",
          text: "Delete this paragraph.",
        }),
      }),
      createPublicationCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        publication: { id: publicationId, novelId: canonical.novelId },
      }),
      createPublicationVolumeCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        volume: capturePublicationVolume({
          id: volumeId,
          publicationId,
          orderKey: "8000",
          title: "Delete Volume",
        }),
      }),
      createPublicationChapterCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        chapter: capturePublicationChapter({
          id: chapterId,
          publicationId,
          volumeId,
          orderKey: "8000",
          title: "Delete Chapter",
          paragraphIds: [paragraphId],
        }),
      }),
      createStoryUnitCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        storyUnit: captureStoryUnit({
          id: guardedStoryUnitId,
          outlineId,
          orderKey: "8100",
          title: "Guarded By Paragraph",
          planningStatus: "outlined",
          realizationStatus: "pending",
        }),
      }),
      createParagraphCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        paragraph: captureParagraph({
          id: guardParagraphId,
          storyUnitId: guardedStoryUnitId,
          orderKey: "8100",
          text: "Guarding paragraph.",
        }),
      }),
      createPublicationVolumeCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        volume: capturePublicationVolume({
          id: guardVolumeId,
          publicationId,
          orderKey: "8100",
          title: "Guard Volume",
        }),
      }),
      createPublicationChapterCreateOperation({
        operationId: captureNovelOperationId(`delete_setup_${++operationSequence}`),
        chapter: capturePublicationChapter({
          id: guardChapterId,
          publicationId,
          volumeId: guardVolumeId,
          orderKey: "8100",
          title: "Guard Chapter",
          paragraphIds: [guardParagraphId],
        }),
      }),
    ],
    conversationId: conversation,
    baseRevision: await application.canonicalWrites.getCurrentRevision(),
  });

  const deleteTool = registry.require("NovelDelete");

  // Referenced: parent story unit has a child.
  const referencedResult = await deleteTool.handler.execute(
    context(conversation, 1),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "story_unit", id: parentId }] },
    progress,
  );
  assert.equal(referencedResult.details.items[0].status, "rejected");
  assert.equal(referencedResult.details.items[0].reason, "referenced");

  // Paragraph delete removes it from the chapter selection too.
  const paragraphDelete = await deleteTool.handler.execute(
    context(conversation, 2),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "paragraph", id: paragraphId }] },
    progress,
  );
  assert.equal(paragraphDelete.details.items[0].status, "applied");
  const chapterRead = await application.publicationQueries.getChapter(
    canonicalNovelReadScope,
    chapterId,
  );
  assert.deepEqual(chapterRead.chapter.paragraphIds, []);

  // Character and location delete directly.
  const characterDelete = await deleteTool.handler.execute(
    context(conversation, 3),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "character", id: characterId }] },
    progress,
  );
  assert.equal(characterDelete.details.items[0].status, "applied");
  const locationDelete = await deleteTool.handler.execute(
    context(conversation, 4),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "location", id: locationId }] },
    progress,
  );
  assert.equal(locationDelete.details.items[0].status, "applied");

  // Leaf story unit without children or plan deletes.
  const leafDelete = await deleteTool.handler.execute(
    context(conversation, 5),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "story_unit", id: leafId }] },
    progress,
  );
  assert.equal(leafDelete.details.items[0].status, "applied");

  // Volume with a chapter rejects; after chapter delete the volume deletes.
  const volumeRejected = await deleteTool.handler.execute(
    context(conversation, 6),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "volume", id: volumeId }] },
    progress,
  );
  assert.equal(volumeRejected.details.items[0].status, "rejected");
  assert.equal(volumeRejected.details.items[0].reason, "referenced");
  const chapterDelete = await deleteTool.handler.execute(
    context(conversation, 7),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "chapter", id: chapterId }] },
    progress,
  );
  assert.equal(chapterDelete.details.items[0].status, "applied");
  const volumeDelete = await deleteTool.handler.execute(
    context(conversation, 8),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "volume", id: volumeId }] },
    progress,
  );
  assert.equal(volumeDelete.details.items[0].status, "applied");

  // Missing id reports rejected with not_found reason.
  const missingResult = await deleteTool.handler.execute(
    context(conversation, 9),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "character", id: "character_missing_delete" }] },
    progress,
  );
  assert.equal(missingResult.details.items[0].status, "rejected");
  assert.equal(missingResult.details.items[0].reason, "not_found");

  // Precheck: story unit with paragraph children rejects (novel_paragraphs.story_unit_id FK).
  const guardedStoryDelete = await deleteTool.handler.execute(
    context(conversation, 10),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "story_unit", id: guardedStoryUnitId }] },
    progress,
  );
  assert.equal(guardedStoryDelete.details.items[0].status, "rejected");
  assert.equal(guardedStoryDelete.details.items[0].reason, "referenced");

  // Precheck: chapter with chapter-paragraph bindings rejects (novel_chapter_paragraphs FK).
  const guardedChapterDelete = await deleteTool.handler.execute(
    context(conversation, 11),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ kind: "chapter", id: guardChapterId }] },
    progress,
  );
  assert.equal(guardedChapterDelete.details.items[0].status, "rejected");
  assert.equal(guardedChapterDelete.details.items[0].reason, "referenced");

  // Redaction: no novel content in structured logs.
  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "Delete Me",
    "Delete Place",
    "Delete this paragraph.",
    "Delete Volume",
    root,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("novel delete tools smoke passed");
} finally {
  if (canonicalStore) await canonicalStore.close();
  await rm(root, { recursive: true, force: true });
}
