import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTempDirectory } from "./fixtures/temp-directory.mjs";
import {
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NovelParagraphToolService,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraphId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createNovelParagraphToolRegistry,
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

const root = await mkdtemp(join(tmpdir(), "novel-paragraph-tools-"));
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
    revisionFactory: new FixedRevisionFactory("revision_paragraph_tools_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  const clock = new SequenceClock();
  let paragraphSequence = 0;
  let operationSequence = 0;
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  const service = new NovelParagraphToolService({
    paragraphQueries: application.paragraphQueries,
    canonicalWrites: application.canonicalWrites,
    identityFactory: {
      createParagraphId: () =>
        captureParagraphId(`paragraph_generated_${++paragraphSequence}`),
      createOperationId: () =>
        captureNovelOperationId(`paragraph_tool_operation_${++operationSequence}`),
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
  const outlineId = captureStoryOutlineId("outline_paragraph_tools");
  const storyUnitId = captureStoryUnitId("story_unit_paragraph_tools");
  await application.canonicalWrites.applyOperations({
    operations: [
      createStoryOutlineCreateOperation({
        operationId: captureNovelOperationId(`paragraph_tool_setup_${++operationSequence}`),
        outline: captureStoryOutline({
          id: outlineId,
          novelId: canonical.novelId,
        }),
      }),
      createStoryUnitCreateOperation({
        operationId: captureNovelOperationId(`paragraph_tool_setup_${++operationSequence}`),
        storyUnit: captureStoryUnit({
          id: storyUnitId,
          outlineId,
          orderKey: "8000",
          title: "Leaf",
          planningStatus: "ready",
          realizationStatus: "in-progress",
        }),
      }),
    ],
    conversationId: conversation,
    baseRevision: await application.canonicalWrites.getCurrentRevision(),
  });

  const writeTool = registry.require("NovelParagraphWrite");
  const readTool = registry.require("NovelParagraphRead");
  const editTool = registry.require("NovelParagraphEdit");

  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
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
      ["paragraph_generated_1", "applied"],
      ["paragraph_second", "applied"],
    ],
  );
  const writeRevision = writeResult.details.revision.currentRevision;

  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    { storyUnitId },
    progress,
  );
  assert.deepEqual(
    readResult.details.paragraphs.map((paragraph) => paragraph.id),
    ["paragraph_generated_1", "paragraph_second"],
  );
  assert.equal(readResult.details.paragraphs[0].text, "First paragraph");
  assert.equal(readResult.details.revision.currentRevision, writeRevision);

  const editResult = await editTool.handler.execute(
    context(conversation, 3),
    {
      baseRevision: writeRevision,
      values: [
        {
          id: "paragraph_second",
          value: { text: "Second paragraph revised" },
        },
      ],
    },
    progress,
  );
  assert.equal(editResult.details.items[0].status, "applied");
  const afterEdit = await readTool.handler.execute(
    context(conversation, 4),
    { storyUnitId },
    progress,
  );
  assert.equal(
    afterEdit.details.paragraphs[1].text,
    "Second paragraph revised",
  );

  // Missing paragraph edit rejects the whole batch.
  const missingEdit = await editTool.handler.execute(
    context(conversation, 5),
    {
      baseRevision: afterEdit.details.revision.currentRevision,
      values: [
        { id: "paragraph_missing", value: { text: "x" } },
        { id: "paragraph_second", value: { text: "y" } },
      ],
    },
    progress,
  );
  assert.deepEqual(
    [missingEdit.details.items[0].status, missingEdit.details.items[0].reason],
    ["rejected", "not_found"],
  );
  const afterRejected = await readTool.handler.execute(
    context(conversation, 6),
    { storyUnitId },
    progress,
  );
  assert.equal(
    afterRejected.details.paragraphs[1].text,
    "Second paragraph revised",
  );

  // Redaction: no paragraph text in structured logs.
  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "First paragraph",
    "Second paragraph",
    "Second paragraph revised",
    root,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("novel paragraph tools smoke passed");
} finally {
  await canonicalStore?.close();
  await removeTempDirectory(root);
}
