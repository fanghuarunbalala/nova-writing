import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  OutlineToolService,
  captureCharacterId,
  captureNovelId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  createCharacterCreateOperation,
  createNovelOutlineToolRegistry,
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
      new Date(Date.UTC(2026, 7, 5, 10, 0, 0, this.offset++)).toISOString(),
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

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const key of Object.keys(entry.fields)) {
      assert.equal(
        [
          "payload",
          "content",
          "text",
          "prompt",
          "path",
          "message",
          "error",
          "stack",
          "cause",
        ].includes(key),
        false,
      );
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-outline-tools-"));
const logs = [];
const logger = new CollectingLogger(logs);

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
  const canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_outline_tools_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  const clock = new SequenceClock();
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  let operationSequence = 0;
  const service = new OutlineToolService({
    novelId: canonical.novelId,
    outlineQueries: application.outlineQueries,
    canonicalWrites: application.canonicalWrites,
    identityFactory: {
      createStoryOutlineId: () => "outline_tool_auto",
      createStoryUnitId: () => "story_unit_generated",
      createOperationId: () =>
        captureNovelOperationId(`outline_tool_operation_${++operationSequence}`),
    },
    logger,
  });
  const registry = createNovelOutlineToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    ["NovelOutlineEdit", "NovelOutlineRead", "NovelOutlineWrite"],
  );
  assert.deepEqual(NOVEL_OUTLINE_TOOL_GROUP_MANIFEST.tools, [
    "NovelOutlineRead",
    "NovelOutlineWrite",
    "NovelOutlineEdit",
  ]);

  const conversation = "conversation_outline_tools";
  await application.canonicalWrites.applyOperations({
    operations: [
      createCharacterCreateOperation({
        operationId: captureNovelOperationId("outline_tool_character"),
        id: captureCharacterId("character_protagonist"),
        profile: { name: "PROTAGONIST_NAME", aliases: [] },
        timestamp: clock.now(),
      }),
    ],
    conversationId: conversation,
  });

  // Write: batch create with defaults, auto outline, embedded leaf plan.
  const writeTool = registry.require("NovelOutlineWrite");
  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      values: [
        { id: "story_unit_root", title: "Root arc" },
        {
          id: "story_unit_leaf",
          title: "First leaf",
          intent: "INTENT_MARKER",
          parentId: "story_unit_root",
          leaf: {
            settingMode: "location-independent",
            characters: [{ characterId: "character_protagonist" }],
            locations: [],
            events: [
              {
                id: "event_1",
                orderKey: "8000",
                description: "EVENT_DESC",
              },
            ],
            rhythmBeats: [],
            entityChanges: [],
          },
        },
      ],
    },
    progress,
  );
  assert.deepEqual(
    writeResult.details.items.map((item) => [item.id, item.status]),
    [
      ["story_unit_root", "applied"],
      ["story_unit_leaf", "applied"],
    ],
  );
  const writeRevision = writeResult.details.revision.currentRevision;
  assert.notEqual(writeRevision, "revision_outline_tools_base");

  // Read canonical: auto-created outline, defaults, embedded plan without storyUnitId.
  const readTool = registry.require("NovelOutlineRead");
  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    { includePlans: true },
    progress,
  );
  assert.equal(readResult.details.outline.id, "outline_tool_auto");
  assert.equal(readResult.details.units.length, 2);
  const rootUnit = readResult.details.units[0];
  const leafUnit = readResult.details.units[1];
  assert.equal(rootUnit.planningStatus, "idea");
  assert.equal(rootUnit.realizationStatus, "pending");
  assert.equal(rootUnit.orderKey, "8000");
  assert.equal(rootUnit.parentId, undefined);
  assert.equal(rootUnit.plan, undefined);
  assert.equal(rootUnit.progress.totalLeafCount, 1);
  assert.equal(leafUnit.parentId, "story_unit_root");
  assert.equal(leafUnit.plan.characters[0].characterId, "character_protagonist");
  assert.equal(JSON.stringify(leafUnit.plan).includes("storyUnitId"), false);
  assert.equal(readResult.details.revision.currentRevision, writeRevision);

  // Edit: partial overwrite, null clearing, leaf partial update, leaf:null clear.
  const editTool = registry.require("NovelOutlineEdit");
  const titleEdit = await editTool.handler.execute(
    context(conversation, 3),
    {
      baseRevision: writeRevision,
      values: [{ id: "story_unit_leaf", value: { title: "Second leaf" } }],
    },
    progress,
  );
  assert.equal(titleEdit.details.items[0].status, "applied");
  const afterTitle = await readTool.handler.execute(
    context(conversation, 4),
    { storyUnitId: "story_unit_leaf", includePlans: true },
    progress,
  );
  assert.equal(afterTitle.details.units[0].title, "Second leaf");
  assert.equal(afterTitle.details.units[0].intent, "INTENT_MARKER");

  await editTool.handler.execute(
    context(conversation, 5),
    { values: [{ id: "story_unit_leaf", value: { intent: null } }] },
    progress,
  );
  const afterIntentClear = await readTool.handler.execute(
    context(conversation, 6),
    { storyUnitId: "story_unit_leaf" },
    progress,
  );
  assert.equal(afterIntentClear.details.units[0].intent, undefined);

  await editTool.handler.execute(
    context(conversation, 7),
    {
      values: [
        {
          id: "story_unit_leaf",
          value: {
            leaf: {
              events: [
                {
                  id: "event_2",
                  orderKey: "4000",
                  description: "EVENT_2_DESC",
                },
              ],
            },
          },
        },
      ],
    },
    progress,
  );
  const afterPlanPartial = await readTool.handler.execute(
    context(conversation, 8),
    { storyUnitId: "story_unit_leaf", includePlans: true },
    progress,
  );
  assert.equal(afterPlanPartial.details.units[0].plan.events.length, 1);
  assert.equal(afterPlanPartial.details.units[0].plan.events[0].id, "event_2");
  assert.equal(afterPlanPartial.details.units[0].plan.characters.length, 1);

  await editTool.handler.execute(
    context(conversation, 9),
    { values: [{ id: "story_unit_leaf", value: { leaf: null } }] },
    progress,
  );
  const afterPlanClear = await readTool.handler.execute(
    context(conversation, 10),
    { storyUnitId: "story_unit_leaf", includePlans: true },
    progress,
  );
  assert.equal(afterPlanClear.details.units[0].plan, undefined);

  // Edit: move to root via parentId:null; missing target rejected (whole batch unapplied).
  const moveEdit = await editTool.handler.execute(
    context(conversation, 11),
    { values: [{ id: "story_unit_leaf", value: { parentId: null } }] },
    progress,
  );
  assert.equal(moveEdit.details.items[0].status, "applied");
  const afterMove = await readTool.handler.execute(
    context(conversation, 12),
    { storyUnitId: "story_unit_leaf" },
    progress,
  );
  assert.equal(afterMove.details.units[0].parentId, undefined);
  assert.equal(afterMove.details.units[0].orderKey, "C000");

  const missingEdit = await editTool.handler.execute(
    context(conversation, 13),
    { values: [{ id: "story_unit_missing", value: { title: "x" } }] },
    progress,
  );
  assert.deepEqual(
    [missingEdit.details.items[0].status, missingEdit.details.items[0].reason],
    ["rejected", "not_found"],
  );

  // Write: duplicate rejected with the whole batch left unapplied.
  const duplicateWrite = await writeTool.handler.execute(
    context(conversation, 14),
    {
      values: [
        { id: "story_unit_batch1", title: "Batch one" },
        { id: "story_unit_root", title: "Duplicate" },
        { id: "story_unit_batch3", title: "Never attempted" },
      ],
    },
    progress,
  );
  assert.deepEqual(
    duplicateWrite.details.items.map((item) => [item.id, item.status]),
    [["story_unit_root", "rejected"]],
  );
  assert.equal(duplicateWrite.details.items[0].reason, "duplicate_id");
  const afterRejectedBatch = await readTool.handler.execute(
    context(conversation, 15),
    {},
    progress,
  );
  assert.equal(
    afterRejectedBatch.details.units.some(
      (unit) => unit.id === "story_unit_batch1",
    ),
    false,
  );

  // Optimistic lock: stale baseRevision write is rejected as a ToolError.
  const staleWrite = writeTool.handler.execute(
    context(conversation, 16),
    {
      baseRevision: writeRevision,
      values: [{ id: "story_unit_stale", title: "Stale" }],
    },
    progress,
  );
  await assert.rejects(staleWrite, (error) => {
    assert.equal(error.code, "NOVEL_OUTLINE_WRITE_FAILED");
    return true;
  });

  // Write without an id: the host generates and returns the id.
  const generatedWrite = await writeTool.handler.execute(
    context(conversation, 17),
    { values: [{ title: "Generated unit" }] },
    progress,
  );
  assert.equal(generatedWrite.details.items[0].id, "story_unit_generated");
  assert.equal(generatedWrite.details.items[0].status, "applied");

  await assertRedacted(logs, [
    root,
    "EVENT_DESC",
    "PROTAGONIST_NAME",
    "INTENT_MARKER",
  ]);
  process.stdout.write("novel-outline-tools smoke passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
