import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  NovelDraftSessionService,
  NovelPublicationToolService,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraph,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createNovelPublicationToolRegistry,
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
      new Date(Date.UTC(2026, 7, 6, 10, 0, 0, this.offset++)).toISOString(),
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

const root = await mkdtemp(join(tmpdir(), "novel-publication-tools-"));
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
    revisionFactory: new FixedRevisionFactory("revision_publication_tools_base"),
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
  let volumeSequence = 0;
  let chapterSequence = 0;
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: {
      createDraftSessionId: () => `draft_publication_tools_${++draftSequence}`,
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
  const service = new NovelPublicationToolService({
    publication: application.publication,
    publicationQueries: application.publicationQueries,
    paragraphs: application.paragraphQueries,
    drafts,
    identityFactory: {
      createPublicationStructureId: () =>
        capturePublicationStructureId("publication_tools_auto"),
      createPublicationVolumeId: () =>
        capturePublicationVolumeId(`volume_generated_${++volumeSequence}`),
      createPublicationChapterId: () =>
        capturePublicationChapterId(`chapter_generated_${++chapterSequence}`),
    },
    logger,
  });
  const registry = createNovelPublicationToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    [
      "NovelChapterEdit",
      "NovelChapterRead",
      "NovelChapterWrite",
      "NovelVolumeEdit",
      "NovelVolumeRead",
      "NovelVolumeWrite",
    ],
  );
  assert.deepEqual(NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST.tools, [
    "NovelVolumeRead",
    "NovelVolumeWrite",
    "NovelVolumeEdit",
    "NovelChapterRead",
    "NovelChapterWrite",
    "NovelChapterEdit",
  ]);

  const conversation = "conversation_publication_tools";
  const session = await drafts.startDraft(conversation);
  const outlineId = captureStoryOutlineId("outline_publication_tools");
  const storyUnitId = captureStoryUnitId("story_unit_publication_tools");
  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: storyUnitId,
    outlineId,
    orderKey: "8000",
    title: "Leaf",
    planningStatus: "ready",
    realizationStatus: "in-progress",
  }));
  const paragraphOneId = captureParagraphId("paragraph_publication_one");
  const paragraphTwoId = captureParagraphId("paragraph_publication_two");
  await application.paragraphs.createParagraph(session, captureParagraph({
    id: paragraphOneId,
    storyUnitId,
    orderKey: "8000",
    text: "Opening line.",
  }));
  await application.paragraphs.createParagraph(session, captureParagraph({
    id: paragraphTwoId,
    storyUnitId,
    orderKey: "80008000",
    text: "Cliffhanger line.",
  }));

  const volumeWriteTool = registry.require("NovelVolumeWrite");
  const volumeReadTool = registry.require("NovelVolumeRead");
  const chapterWriteTool = registry.require("NovelChapterWrite");
  const chapterReadTool = registry.require("NovelChapterRead");
  const chapterEditTool = registry.require("NovelChapterEdit");

  const volumeWrite = await volumeWriteTool.handler.execute(
    context(conversation, 1),
    { values: [{ title: "Volume One" }] },
    progress,
  );
  assert.equal(volumeWrite.details.items[0].status, "appended");
  const volumeId = volumeWrite.details.items[0].id;

  const volumeRead = await volumeReadTool.handler.execute(
    context(conversation, 2),
    { scope: "draft" },
    progress,
  );
  assert.equal(volumeRead.details.volumes.length, 1);
  assert.equal(volumeRead.details.volumes[0].id, volumeId);

  const chapterWrite = await chapterWriteTool.handler.execute(
    context(conversation, 3),
    {
      values: [
        {
          volumeId,
          title: "Chapter One",
          paragraphIds: [paragraphOneId, paragraphTwoId],
        },
      ],
    },
    progress,
  );
  assert.equal(chapterWrite.details.items[0].status, "appended");
  const chapterId = chapterWrite.details.items[0].id;

  const chapterRead = await chapterReadTool.handler.execute(
    context(conversation, 4),
    { scope: "draft", chapterId, includeContent: true },
    progress,
  );
  assert.equal(chapterRead.details.chapters.length, 1);
  assert.deepEqual(chapterRead.details.chapters[0].paragraphIds, [
    paragraphOneId,
    paragraphTwoId,
  ]);
  assert.equal(
    chapterRead.details.chapters[0].content,
    "Opening line.\nCliffhanger line.",
  );
  assert.equal(chapterRead.details.chapters[0].paragraphs.length, 2);

  // Cliffhanger split: chapter one keeps the opening, a new chapter takes the tail.
  const chapterEdit = await chapterEditTool.handler.execute(
    context(conversation, 5),
    {
      values: [
        {
          id: chapterId,
          value: { paragraphIds: [paragraphOneId] },
        },
      ],
    },
    progress,
  );
  assert.equal(chapterEdit.details.items[0].status, "updated");
  const splitWrite = await chapterWriteTool.handler.execute(
    context(conversation, 6),
    {
      values: [
        {
          volumeId,
          title: "Chapter Two",
          paragraphIds: [paragraphTwoId],
        },
      ],
    },
    progress,
  );
  assert.equal(splitWrite.details.items[0].status, "appended");
  const readAll = await chapterReadTool.handler.execute(
    context(conversation, 7),
    { scope: "draft", volumeId, includeContent: true },
    progress,
  );
  assert.deepEqual(
    readAll.details.chapters.map((chapter) => chapter.paragraphIds),
    [[paragraphOneId], [paragraphTwoId]],
  );
  console.log("novel publication tools smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
