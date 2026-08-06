import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NovelDraftSessionService,
  NovelParagraphToolService,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraphId,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createNovelParagraphToolRegistry,
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

const root = await mkdtemp(join(tmpdir(), "novel-paragraph-tools-"));
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
    revisionFactory: new FixedRevisionFactory("revision_paragraph_tools_base"),
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
  let paragraphSequence = 0;
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: {
      createDraftSessionId: () => `draft_paragraph_tools_${++draftSequence}`,
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
  const service = new NovelParagraphToolService({
    paragraphs: application.paragraphs,
    paragraphQueries: application.paragraphQueries,
    drafts,
    identityFactory: {
      createParagraphId: () =>
        captureParagraphId(`paragraph_generated_${++paragraphSequence}`),
    },
    logger,
  });
  const registry = createNovelParagraphToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    ["NovelParagraphEdit", "NovelParagraphRead", "NovelParagraphWrite"],
  );
  assert.deepEqual(NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST.tools, [
    "NovelParagraphRead",
    "NovelParagraphWrite",
    "NovelParagraphEdit",
  ]);

  const conversation = "conversation_paragraph_tools";
  const session = await drafts.startDraft(conversation);
  const outlineId = captureStoryOutlineId("outline_paragraph_tools");
  const storyUnitId = captureStoryUnitId("story_unit_paragraph_tools");
  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: storyUnitId,
    outlineId,
    orderKey: "8000",
    title: "Leaf",
    planningStatus: "ready",
    realizationStatus: "in-progress",
  }));

  const writeTool = registry.require("NovelParagraphWrite");
  const readTool = registry.require("NovelParagraphRead");
  const editTool = registry.require("NovelParagraphEdit");

  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      values: [
        { storyUnitId, text: "First paragraph" },
        {
          id: "paragraph_second",
          storyUnitId,
          orderKey: "C000",
          text: "Second paragraph",
        },
      ],
    },
    progress,
  );
  assert.deepEqual(
    writeResult.details.items.map((item) => [item.id, item.status]),
    [
      ["paragraph_generated_1", "appended"],
      ["paragraph_second", "appended"],
    ],
  );

  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    { scope: "draft", storyUnitId },
    progress,
  );
  assert.deepEqual(
    readResult.details.paragraphs.map((paragraph) => paragraph.id),
    ["paragraph_generated_1", "paragraph_second"],
  );
  assert.equal(readResult.details.paragraphs[0].text, "First paragraph");

  const editResult = await editTool.handler.execute(
    context(conversation, 3),
    {
      values: [
        {
          id: "paragraph_second",
          value: { text: "Second paragraph revised" },
        },
      ],
    },
    progress,
  );
  assert.equal(editResult.details.items[0].status, "updated");
  const afterEdit = await readTool.handler.execute(
    context(conversation, 4),
    { scope: "draft", storyUnitId },
    progress,
  );
  assert.equal(
    afterEdit.details.paragraphs[1].text,
    "Second paragraph revised",
  );

  const canonicalRead = await readTool.handler.execute(
    context(conversation, 5),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalRead.details.paragraphs.length, 0);
  console.log("novel paragraph tools smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
