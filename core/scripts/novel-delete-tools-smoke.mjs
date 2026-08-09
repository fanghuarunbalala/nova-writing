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
  captureLeafStoryUnitPlan,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createCharacterCreateOperation,
  createLeafStoryUnitPlanReplaceOperation,
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
  const currentRevision = () => application.canonicalWrites.getCurrentRevision();

  // Phase 1 — strict semantics (cascade defaults to false) + partial application.
  // Parent story unit with a child is referenced-rejected, reason in content.
  const parentRejected = await deleteTool.handler.execute(
    context(conversation, 1),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "story_unit", id: parentId }] },
    progress,
  );
  assert.equal(parentRejected.details.items[0].status, "rejected");
  assert.equal(parentRejected.details.items[0].reason, "referenced");
  assert.match(parentRejected.content[0].text, /^Deletion rejected\./);
  assert.equal(
    JSON.stringify(parentRejected.content[0].text).includes("referenced"),
    true,
  );

  // Volume still containing a chapter is referenced-rejected.
  const volumeRejected = await deleteTool.handler.execute(
    context(conversation, 2),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "volume", id: volumeId }] },
    progress,
  );
  assert.equal(volumeRejected.details.items[0].status, "rejected");
  assert.equal(volumeRejected.details.items[0].reason, "referenced");

  // Story unit guarded by its own paragraph is referenced-rejected.
  const guardedStoryRejected = await deleteTool.handler.execute(
    context(conversation, 3),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "story_unit", id: guardedStoryUnitId }] },
    progress,
  );
  assert.equal(guardedStoryRejected.details.items[0].status, "rejected");
  assert.equal(guardedStoryRejected.details.items[0].reason, "referenced");

  // Chapter bound to paragraphs is referenced-rejected.
  const guardedChapterRejected = await deleteTool.handler.execute(
    context(conversation, 4),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "chapter", id: guardChapterId }] },
    progress,
  );
  assert.equal(guardedChapterRejected.details.items[0].status, "rejected");
  assert.equal(guardedChapterRejected.details.items[0].reason, "referenced");

  // Mixed batch partial-apply: parent rejected, character applied with its record.
  const mixedBatch = await deleteTool.handler.execute(
    context(conversation, 5),
    {
      baseRevision: await currentRevision(),
      values: [
        { kind: "story_unit", id: parentId },
        { kind: "character", id: characterId },
      ] },
    progress,
  );
  assert.deepEqual(
    mixedBatch.details.items.map((item) => [item.id, item.status, item.reason]),
    [
      [parentId, "rejected", "referenced"],
      [characterId, "applied", undefined],
    ],
  );
  assert.equal(mixedBatch.details.deleted.length, 1);
  assert.equal(mixedBatch.details.deleted[0].kind, "character");
  assert.equal(mixedBatch.details.deleted[0].data.name, "Delete Me");
  assert.match(mixedBatch.content[0].text, /^Deletion rejected\./);
  assert.equal(
    JSON.stringify(mixedBatch.content[0].text).includes(characterId),
    true,
  );

  // Location deletes directly with its full record.
  const locationDelete = await deleteTool.handler.execute(
    context(conversation, 6),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "location", id: locationId }] },
    progress,
  );
  assert.equal(locationDelete.details.items[0].status, "applied");
  assert.equal(locationDelete.details.deleted.length, 1);
  assert.equal(locationDelete.details.deleted[0].kind, "location");
  assert.equal(locationDelete.details.deleted[0].data.name, "Delete Place");

  // Phase 2 — cascade:true deletes parents with dependents and returns them.
  // Chapter cascade unbinds its paragraphs; the paragraph entity itself stays.
  const chapterCascade = await deleteTool.handler.execute(
    context(conversation, 7),
    {
      baseRevision: await currentRevision(),
      cascade: true,
      values: [{ kind: "chapter", id: guardChapterId }] },
    progress,
  );
  assert.equal(chapterCascade.details.items[0].status, "applied");
  assert.equal(chapterCascade.details.deleted.length, 1);
  assert.equal(chapterCascade.details.deleted[0].kind, "chapter");
  assert.equal(chapterCascade.details.deleted[0].data.id, guardChapterId);
  assert.equal(
    await application.publicationQueries.getChapter(
      canonicalNovelReadScope,
      guardChapterId,
    ),
    undefined,
  );
  assert.notEqual(
    await application.paragraphQueries.getParagraph(
      canonicalNovelReadScope,
      guardParagraphId,
    ),
    undefined,
  );

  // Story unit cascade removes its paragraph; both full records returned.
  const guardedStoryCascade = await deleteTool.handler.execute(
    context(conversation, 8),
    {
      baseRevision: await currentRevision(),
      cascade: true,
      values: [{ kind: "story_unit", id: guardedStoryUnitId }] },
    progress,
  );
  assert.equal(guardedStoryCascade.details.items[0].status, "applied");
  assert.deepEqual(
    new Set(guardedStoryCascade.details.deleted.map((entity) => entity.kind)),
    new Set(["story_unit", "paragraph"]),
  );
  const guardedParagraphRecord = guardedStoryCascade.details.deleted.find(
    (entity) => entity.kind === "paragraph",
  );
  assert.equal(guardedParagraphRecord.data.text, "Guarding paragraph.");

  // Volume cascade removes its chapter; both full records returned.
  const volumeCascade = await deleteTool.handler.execute(
    context(conversation, 9),
    {
      baseRevision: await currentRevision(),
      cascade: true,
      values: [{ kind: "volume", id: volumeId }] },
    progress,
  );
  assert.equal(volumeCascade.details.items[0].status, "applied");
  assert.equal(volumeCascade.details.deleted.length, 2);
  const volumeRecord = volumeCascade.details.deleted.find(
    (entity) => entity.kind === "volume",
  );
  const chapterRecord = volumeCascade.details.deleted.find(
    (entity) => entity.kind === "chapter",
  );
  assert.equal(volumeRecord.data.title, "Delete Volume");
  assert.deepEqual(chapterRecord.data.paragraphIds, [paragraphId]);

  // Cascade-skip: requesting the parent and its child dedupes the closure.
  const subtreeCascade = await deleteTool.handler.execute(
    context(conversation, 10),
    {
      baseRevision: await currentRevision(),
      cascade: true,
      values: [
        { kind: "story_unit", id: parentId },
        { kind: "story_unit", id: leafId },
      ] },
    progress,
  );
  assert.deepEqual(
    subtreeCascade.details.items.map((item) => [item.id, item.status]),
    [
      [parentId, "applied"],
      [leafId, "applied"],
    ],
  );
  assert.equal(subtreeCascade.details.deleted.length, 3);
  const subtreeIds = subtreeCascade.details.deleted.map((entity) => entity.data.id);
  assert.equal(new Set(subtreeIds).size, 3);
  assert.equal(subtreeIds.includes(parentId), true);
  assert.equal(subtreeIds.includes(leafId), true);
  const subtreeParagraph = subtreeCascade.details.deleted.find(
    (entity) => entity.kind === "paragraph",
  );
  assert.equal(subtreeParagraph.data.text, "Delete this paragraph.");
  // content carries deleted records for the provider this turn.
  assert.match(subtreeCascade.content[0].text, /^Deletion applied\./);
  assert.equal(
    JSON.stringify(subtreeCascade.content[0].text).includes(parentId),
    true,
  );
  assert.equal(
    JSON.stringify(subtreeCascade.content[0].text).includes(
      "Delete this paragraph.",
    ),
    true,
  );

  // Missing id reports rejected with not_found reason.
  const missingResult = await deleteTool.handler.execute(
    context(conversation, 11),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "character", id: "character_missing_delete" }] },
    progress,
  );
  assert.equal(missingResult.details.items[0].status, "rejected");
  assert.equal(missingResult.details.items[0].reason, "not_found");
  assert.match(missingResult.content[0].text, /^Deletion rejected\./);

  // Read-back: all cascaded entities are actually gone.
  assert.equal(
    await application.outlineQueries.getStoryUnit(canonicalNovelReadScope, parentId),
    undefined,
  );
  assert.equal(
    await application.outlineQueries.getStoryUnit(canonicalNovelReadScope, leafId),
    undefined,
  );
  assert.equal(
    await application.paragraphQueries.getParagraph(canonicalNovelReadScope, paragraphId),
    undefined,
  );
  assert.equal(
    await application.publicationQueries.getVolume(canonicalNovelReadScope, volumeId),
    undefined,
  );
  assert.equal(
    await application.publicationQueries.getChapter(canonicalNovelReadScope, chapterId),
    undefined,
  );
  assert.equal(
    await application.characterQueries.get(canonicalNovelReadScope, characterId),
    undefined,
  );
  assert.equal(
    await application.locationQueries.get(canonicalNovelReadScope, locationId),
    undefined,
  );

  // Cascade clears projection evidence: delete a story unit whose leaf plan
  // references a character; the binding rows must go with it so the referenced
  // character can still be deleted afterwards.
  const planUnitId = captureStoryUnitId("story_unit_plan_delete");
  const planCharacterId = captureCharacterId("character_plan_delete");
  await application.canonicalWrites.applyOperations({
    operations: [
      createCharacterCreateOperation({
        operationId: captureNovelOperationId(`delete_extra_${++operationSequence}`),
        id: planCharacterId,
        profile: { name: "Plan Character", aliases: [] },
        timestamp: clock.now(),
      }),
      createStoryUnitCreateOperation({
        operationId: captureNovelOperationId(`delete_extra_${++operationSequence}`),
        storyUnit: captureStoryUnit({
          id: planUnitId,
          outlineId,
          orderKey: "8200",
          title: "Plan Unit",
          planningStatus: "ready",
          realizationStatus: "pending",
        }),
      }),
      createLeafStoryUnitPlanReplaceOperation({
        operationId: captureNovelOperationId(`delete_extra_${++operationSequence}`),
        plan: captureLeafStoryUnitPlan({
          storyUnitId: planUnitId,
          settingMode: "location-independent",
          characters: [
            { storyUnitId: planUnitId, characterId: planCharacterId },
          ],
          locations: [],
          events: [],
          rhythmBeats: [],
          entityChanges: [],
        }),
      }),
    ],
    conversationId: conversation,
    baseRevision: await currentRevision(),
  });
  const planUnitRejected = await deleteTool.handler.execute(
    context(conversation, 12),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "story_unit", id: planUnitId }] },
    progress,
  );
  assert.equal(planUnitRejected.details.items[0].status, "rejected");
  assert.equal(planUnitRejected.details.items[0].reason, "referenced");
  const planUnitCascade = await deleteTool.handler.execute(
    context(conversation, 13),
    {
      baseRevision: await currentRevision(),
      cascade: true,
      values: [{ kind: "story_unit", id: planUnitId }] },
    progress,
  );
  assert.equal(planUnitCascade.details.items[0].status, "applied");
  assert.equal(
    planUnitCascade.details.deleted.some(
      (entity) =>
        entity.kind === "story_unit" && entity.data.id === planUnitId,
    ),
    true,
  );
  const planCharacterDelete = await deleteTool.handler.execute(
    context(conversation, 14),
    {
      baseRevision: await currentRevision(),
      values: [{ kind: "character", id: planCharacterId }] },
    progress,
  );
  assert.equal(planCharacterDelete.details.items[0].status, "applied");

  // Redaction: deleted content/titles only reach the tool result, never logs.
  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "Delete Me",
    "Delete Place",
    "Delete this paragraph.",
    "Guarding paragraph.",
    "Delete Volume",
    "Plan Character",
    root,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("novel delete tools smoke passed");
} finally {
  if (canonicalStore) await canonicalStore.close();
  await rm(root, { recursive: true, force: true });
}
