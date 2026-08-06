import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  NovelDeleteToolService,
  NovelDraftSessionService,
  captureCharacterId,
  captureLocationId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraph,
  captureParagraphId,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createNovelDeleteToolRegistry,
  draftNovelReadScope,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
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
let canonicalStore;
let draftStore;

const context = (conversationId, index) => ({
  conversationId,
  runId: `run_${conversationId}_${index}`,
  toolCallId: `call_${conversationId}_${index}`,
  signal: new AbortController().signal,
});
const progress = { async emit() {} };

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
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  let draftSequence = 0;
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: {
      createDraftSessionId: () => `draft_delete_tools_${++draftSequence}`,
    },
    clock,
    logger,
  });
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  const service = new NovelDeleteToolService({
    outline: application.outline,
    outlineQueries: application.outlineQueries,
    characters: application.characters,
    characterQueries: application.characterQueries,
    locations: application.locations,
    locationQueries: application.locationQueries,
    paragraphs: application.paragraphs,
    paragraphQueries: application.paragraphQueries,
    publication: application.publication,
    publicationQueries: application.publicationQueries,
    drafts,
    logger,
  });
  const registry = createNovelDeleteToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    ["NovelDelete"],
  );
  assert.deepEqual(NOVEL_DELETE_TOOL_GROUP_MANIFEST.tools, ["NovelDelete"]);

  const conversation = "conversation_delete_tools";
  const session = await drafts.startDraft(conversation);
  const outlineId = captureStoryOutlineId("outline_delete_tools");
  const parentId = captureStoryUnitId("story_unit_parent_delete");
  const leafId = captureStoryUnitId("story_unit_leaf_delete");
  const characterId = captureCharacterId("character_delete");
  const locationId = captureLocationId("location_delete");
  const paragraphId = captureParagraphId("paragraph_delete");
  const volumeId = capturePublicationVolumeId("volume_delete");
  const chapterId = capturePublicationChapterId("chapter_delete");
  const publicationId = capturePublicationStructureId("publication_delete");

  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: parentId,
    outlineId,
    orderKey: "8000",
    title: "Parent",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }));
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: leafId,
    outlineId,
    parentId,
    orderKey: "8000",
    title: "Leaf",
    planningStatus: "ready",
    realizationStatus: "in-progress",
  }));
  await application.characters.create(session, characterId, {
    name: "Delete Me",
    aliases: [],
  });
  await application.locations.create(session, locationId, {
    name: "Delete Place",
    aliases: [],
  });
  await application.paragraphs.createParagraph(session, captureParagraph({
    id: paragraphId,
    storyUnitId: leafId,
    orderKey: "8000",
    text: "Delete this paragraph.",
  }));
  await application.publication.createPublication(session, publicationId);
  await application.publication.createVolume(session, capturePublicationVolume({
    id: volumeId,
    publicationId,
    orderKey: "8000",
    title: "Delete Volume",
  }));
  await application.publication.createChapter(session, capturePublicationChapter({
    id: chapterId,
    publicationId,
    volumeId,
    orderKey: "8000",
    title: "Delete Chapter",
    paragraphIds: [paragraphId],
  }));

  const deleteTool = registry.require("NovelDelete");

  // Referenced: parent story unit has a child.
  const referencedResult = await deleteTool.handler.execute(
    context(conversation, 1),
    { values: [{ kind: "story_unit", id: parentId }] },
    progress,
  );
  assert.equal(referencedResult.details.items[0].status, "rejected");
  assert.equal(referencedResult.details.items[0].reason, "referenced");

  // Paragraph delete removes it from the chapter selection too.
  const paragraphDelete = await deleteTool.handler.execute(
    context(conversation, 2),
    { values: [{ kind: "paragraph", id: paragraphId }] },
    progress,
  );
  assert.equal(paragraphDelete.details.items[0].status, "deleted");
  const chapterRead = await application.publicationQueries.getChapter(
    draftNovelReadScope(session),
    chapterId,
  );
  assert.deepEqual(chapterRead.chapter.paragraphIds, []);

  // Character and location delete directly.
  const characterDelete = await deleteTool.handler.execute(
    context(conversation, 3),
    { values: [{ kind: "character", id: characterId }] },
    progress,
  );
  assert.equal(characterDelete.details.items[0].status, "deleted");
  const locationDelete = await deleteTool.handler.execute(
    context(conversation, 4),
    { values: [{ kind: "location", id: locationId }] },
    progress,
  );
  assert.equal(locationDelete.details.items[0].status, "deleted");

  // Leaf story unit without children or plan deletes.
  const leafDelete = await deleteTool.handler.execute(
    context(conversation, 5),
    { values: [{ kind: "story_unit", id: leafId }] },
    progress,
  );
  assert.equal(leafDelete.details.items[0].status, "deleted");

  // Volume with a chapter rejects; after chapter delete the volume deletes.
  const volumeRejected = await deleteTool.handler.execute(
    context(conversation, 6),
    { values: [{ kind: "volume", id: volumeId }] },
    progress,
  );
  assert.equal(volumeRejected.details.items[0].status, "rejected");
  assert.equal(volumeRejected.details.items[0].reason, "referenced");
  const chapterDelete = await deleteTool.handler.execute(
    context(conversation, 7),
    { values: [{ kind: "chapter", id: chapterId }] },
    progress,
  );
  assert.equal(chapterDelete.details.items[0].status, "deleted");
  const volumeDelete = await deleteTool.handler.execute(
    context(conversation, 8),
    { values: [{ kind: "volume", id: volumeId }] },
    progress,
  );
  assert.equal(volumeDelete.details.items[0].status, "deleted");

  // Missing id reports not_found.
  const missingResult = await deleteTool.handler.execute(
    context(conversation, 9),
    { values: [{ kind: "character", id: "character_missing_delete" }] },
    progress,
  );
  assert.equal(missingResult.details.items[0].status, "not_found");
  console.log("novel delete tools smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
