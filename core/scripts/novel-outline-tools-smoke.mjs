import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NovelDraftSessionService,
  OutlineToolService,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  createNovelOutlineToolRegistry,
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
    revisionFactory: new FixedRevisionFactory("revision_outline_tools_base"),
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
      createDraftSessionId: () => `draft_outline_tools_${++draftSequence}`,
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
  const service = new OutlineToolService({
    outline: application.outline,
    outlineQueries: application.outlineQueries,
    drafts,
    identityFactory: {
      createStoryOutlineId: () => "outline_tool_auto",
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
  const session = await drafts.startDraft(conversation);
  await application.characters.create(session, "character_protagonist", {
    name: "PROTAGONIST_NAME",
    aliases: [],
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
    writeResult.details.items.map((item) => [item.id, item.status, item.sequence]),
    [
      ["story_unit_root", "appended", 3],
      ["story_unit_leaf", "appended", 5],
    ],
  );

  // Read draft: auto-created outline, defaults, embedded plan without storyUnitId.
  const readTool = registry.require("NovelOutlineRead");
  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    { scope: "draft", includePlans: true },
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

  // Edit: partial overwrite, null clearing, leaf partial update, leaf:null clear.
  const editTool = registry.require("NovelOutlineEdit");
  const titleEdit = await editTool.handler.execute(
    context(conversation, 3),
    {
      values: [{ id: "story_unit_leaf", value: { title: "Second leaf" } }],
    },
    progress,
  );
  assert.equal(titleEdit.details.items[0].status, "appended");
  const afterTitle = await readTool.handler.execute(
    context(conversation, 4),
    { scope: "draft", storyUnitId: "story_unit_leaf", includePlans: true },
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
    { scope: "draft", storyUnitId: "story_unit_leaf" },
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
    { scope: "draft", storyUnitId: "story_unit_leaf", includePlans: true },
    progress,
  );
  assert.equal(afterPlanPartial.details.units[0].plan.events.length, 1);
  assert.equal(afterPlanPartial.details.units[0].plan.events[0].id, "event_2");
  assert.equal(
    afterPlanPartial.details.units[0].plan.characters.length,
    1,
  );

  await editTool.handler.execute(
    context(conversation, 9),
    { values: [{ id: "story_unit_leaf", value: { leaf: null } }] },
    progress,
  );
  const afterPlanClear = await readTool.handler.execute(
    context(conversation, 10),
    { scope: "draft", storyUnitId: "story_unit_leaf", includePlans: true },
    progress,
  );
  assert.equal(afterPlanClear.details.units[0].plan, undefined);

  // Edit: move to root via parentId:null; missing target rejected.
  const moveEdit = await editTool.handler.execute(
    context(conversation, 11),
    { values: [{ id: "story_unit_leaf", value: { parentId: null } }] },
    progress,
  );
  assert.equal(moveEdit.details.items[0].status, "appended");
  const afterMove = await readTool.handler.execute(
    context(conversation, 12),
    { scope: "draft", storyUnitId: "story_unit_leaf" },
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

  // Write: duplicate rejected, batch stops after the first rejected item.
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
    [
      ["story_unit_batch1", "appended"],
      ["story_unit_root", "rejected"],
    ],
  );
  assert.equal(duplicateWrite.details.items[1].reason, "duplicate_id");

  // Canonical scope is empty until commit.
  const canonicalBefore = await readTool.handler.execute(
    context(conversation, 15),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalBefore.details.units.length, 0);

  const resultRevision = captureNovelRevision("revision_outline_tools_committed");
  const committed = await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_outline_tools"),
    resultRevision,
    committedAt: captureNovelTimestamp("2026-08-05T10:30:00.000Z"),
  });
  assert.equal(committed.status, "committed");

  const canonicalAfter = await readTool.handler.execute(
    context(conversation, 16),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalAfter.details.units.length, 3);
  assert.deepEqual(
    canonicalAfter.details.units.map((unit) => unit.id).sort(),
    ["story_unit_batch1", "story_unit_leaf", "story_unit_root"],
  );

  // Draft isolation: another conversation sees no draft and cannot pollute ours.
  const otherConversation = "conversation_outline_tools_other";
  const otherRead = await readTool.handler.execute(
    context(otherConversation, 1),
    { scope: "draft" },
    progress,
  );
  assert.equal(otherRead.details.units.length, 0);
  await writeTool.handler.execute(
    context(otherConversation, 2),
    { values: [{ id: "story_unit_other", title: "Other conversation" }] },
    progress,
  );
  const firstReadAgain = await readTool.handler.execute(
    context(conversation, 17),
    { scope: "draft" },
    progress,
  );
  assert.equal(
    firstReadAgain.details.units.some((unit) => unit.id === "story_unit_other"),
    false,
  );
  const otherReadAfter = await readTool.handler.execute(
    context(otherConversation, 3),
    { scope: "draft" },
    progress,
  );
  assert.equal(otherReadAfter.details.units.length, 4);
  assert.equal(
    otherReadAfter.details.units.some(
      (unit) => unit.id === "story_unit_other",
    ),
    true,
  );
  const canonicalAfterOther = await readTool.handler.execute(
    context(otherConversation, 4),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalAfterOther.details.units.length, 3);

  assertRedacted(logs, [
    "Root arc",
    "First leaf",
    "Second leaf",
    "INTENT_MARKER",
    "PROTAGONIST_NAME",
    "EVENT_DESC",
    "EVENT_2_DESC",
    "Batch one",
    "Other conversation",
  ]);
  console.log("CORE_SMOKE_TEST_RESULT=pass novel-outline-tools");
} finally {
  if (draftStore) await draftStore.close();
  if (canonicalStore) await canonicalStore.close();
  await rm(root, { recursive: true, force: true });
}
