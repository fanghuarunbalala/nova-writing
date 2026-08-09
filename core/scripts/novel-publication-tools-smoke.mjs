import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTempDirectory } from "./fixtures/temp-directory.mjs";
import {
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  NovelPublicationToolService,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraph,
  captureParagraphId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createNovelPublicationToolRegistry,
  createParagraphCreateOperation,
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
      new Date(Date.UTC(2026, 7, 6, 9, 0, 0, this.offset++)).toISOString(),
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
    revisionFactory: new FixedRevisionFactory("revision_publication_tools_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  const clock = new SequenceClock();
  let operationSequence = 0;
  let volumeSequence = 0;
  let chapterSequence = 0;
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  const service = new NovelPublicationToolService({
    novelId: canonical.novelId,
    publicationQueries: application.publicationQueries,
    paragraphs: application.paragraphQueries,
    canonicalWrites: application.canonicalWrites,
    identityFactory: {
      createPublicationStructureId: () => "publication_tool_auto",
      createPublicationVolumeId: () =>
        `volume_tool_generated_${++volumeSequence}`,
      createPublicationChapterId: () =>
        `chapter_tool_generated_${++chapterSequence}`,
      createOperationId: () =>
        captureNovelOperationId(`publication_tool_operation_${++operationSequence}`),
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
  const outlineId = captureStoryOutlineId("outline_publication_tools");
  const storyUnitId = captureStoryUnitId("story_unit_publication_tools");
  const paragraphOneId = captureParagraphId("paragraph_publication_one");
  const paragraphTwoId = captureParagraphId("paragraph_publication_two");
  await application.canonicalWrites.applyOperations({
    operations: [
      createStoryOutlineCreateOperation({
        operationId: captureNovelOperationId(`publication_tool_setup_${++operationSequence}`),
        outline: captureStoryOutline({
          id: outlineId,
          novelId: canonical.novelId,
        }),
      }),
      createStoryUnitCreateOperation({
        operationId: captureNovelOperationId(`publication_tool_setup_${++operationSequence}`),
        storyUnit: captureStoryUnit({
          id: storyUnitId,
          outlineId,
          orderKey: "8000",
          title: "Leaf",
          planningStatus: "ready",
          realizationStatus: "in-progress",
        }),
      }),
      createParagraphCreateOperation({
        operationId: captureNovelOperationId(`publication_tool_setup_${++operationSequence}`),
        paragraph: captureParagraph({
          id: paragraphOneId,
          storyUnitId,
          orderKey: "8000",
          text: "Opening line.",
        }),
      }),
      createParagraphCreateOperation({
        operationId: captureNovelOperationId(`publication_tool_setup_${++operationSequence}`),
        paragraph: captureParagraph({
          id: paragraphTwoId,
          storyUnitId,
          orderKey: "80008000",
          text: "Cliffhanger line.",
        }),
      }),
    ],
    conversationId: conversation,
    baseRevision: await application.canonicalWrites.getCurrentRevision(),
  });

  const volumeWriteTool = registry.require("NovelVolumeWrite");
  const volumeReadTool = registry.require("NovelVolumeRead");
  const chapterWriteTool = registry.require("NovelChapterWrite");
  const chapterReadTool = registry.require("NovelChapterRead");
  const chapterEditTool = registry.require("NovelChapterEdit");

  const volumeWrite = await volumeWriteTool.handler.execute(
    context(conversation, 1),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [{ title: "Volume One" }],
    },
    progress,
  );
  assert.equal(volumeWrite.details.items[0].status, "applied");
  const volumeId = volumeWrite.details.items[0].id;

  const volumeRead = await volumeReadTool.handler.execute(
    context(conversation, 2),
    {},
    progress,
  );
  assert.equal(volumeRead.details.volumes.length, 1);
  assert.equal(volumeRead.details.volumes[0].id, volumeId);
  // content carries real data (provider serializes content only in the live turn).
  assert.match(volumeRead.content[0].text, /^Volumes read\.\n\{/);
  assert.match(volumeRead.content[0].text, new RegExp(`"id": "${volumeId}"`));

  const chapterWrite = await chapterWriteTool.handler.execute(
    context(conversation, 3),
    {
      baseRevision: volumeRead.details.revision.currentRevision,
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
  assert.equal(
    chapterWrite.details.items[0].status,
    "applied",
    chapterWrite.details.items[0].reason,
  );
  const chapterId = chapterWrite.details.items[0].id;

  const chapterRead = await chapterReadTool.handler.execute(
    context(conversation, 4),
    { chapterId, includeContent: true },
    progress,
  );
  assert.equal(chapterRead.details.chapters.length, 1);
  // content carries real data (provider serializes content only in the live turn).
  assert.match(chapterRead.content[0].text, /^Chapters read\.\n\{/);
  assert.match(chapterRead.content[0].text, new RegExp(`"${paragraphOneId}"`));
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
      baseRevision: chapterRead.details.revision.currentRevision,
      values: [
        {
          id: chapterId,
          value: { paragraphIds: [paragraphOneId] },
        },
      ],
    },
    progress,
  );
  assert.equal(chapterEdit.details.items[0].status, "applied");
  const splitWrite = await chapterWriteTool.handler.execute(
    context(conversation, 6),
    {
      baseRevision: chapterEdit.details.revision.currentRevision,
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
  assert.equal(splitWrite.details.items[0].status, "applied");
  const readAll = await chapterReadTool.handler.execute(
    context(conversation, 7),
    { volumeId, includeContent: true },
    progress,
  );
  assert.deepEqual(
    readAll.details.chapters.map((chapter) => chapter.paragraphIds),
    [[paragraphOneId], [paragraphTwoId]],
  );

  // Redaction: no chapter/paragraph text in structured logs.
  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "Volume One",
    "Chapter One",
    "Opening line.",
    "Cliffhanger line.",
    root,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("novel publication tools smoke passed");
} finally {
  await canonicalStore?.close();
  await removeTempDirectory(root);
}
