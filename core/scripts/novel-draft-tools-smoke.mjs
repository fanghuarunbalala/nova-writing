import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_DRAFT_TOOL_GROUP_MANIFEST,
  NovelDraftSessionService,
  NovelDraftToolService,
  captureNovelRevision,
  captureNovelTimestamp,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createNovelDraftToolRegistry,
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
      new Date(Date.UTC(2026, 7, 6, 15, 0, 0, this.offset++)).toISOString(),
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

const root = await mkdtemp(join(tmpdir(), "novel-draft-tools-"));
const logger = new CollectingLogger([]);
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
    revisionFactory: new FixedRevisionFactory("revision_draft_tools_1"),
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
      createDraftSessionId: () => `draft_draft_tools_${++draftSequence}`,
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
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const keepDraftPlanner = Object.freeze({
    async planKeepDraft() {
      throw new Error("keep-draft is not used by this scenario");
    },
  });
  const service = new NovelDraftToolService({
    drafts,
    commits: application.commits,
    changeSets: application.changeSets,
    prepareRebase: async (session) => {
      const rebase = await application.openRebase({
        canonicalStore,
        draftStore,
        snapshotter,
        keepDraftPlanner,
      });
      try {
        return await rebase.rebases.prepareCandidate(session.id);
      } finally {
        await rebase.close();
      }
    },
    logger,
  });
  const registry = createNovelDraftToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    [
      "NovelDraftCommit",
      "NovelDraftRebase",
      "NovelDraftRollback",
      "NovelDraftStatus",
    ],
  );
  assert.deepEqual(NOVEL_DRAFT_TOOL_GROUP_MANIFEST.tools, [
    "NovelDraftStatus",
    "NovelDraftCommit",
    "NovelDraftRollback",
    "NovelDraftRebase",
  ]);

  const conversation = "conversation_draft_tools_main";
  const freshConversation = "conversation_draft_tools_fresh";
  const conflictConversationA = "conversation_draft_tools_conflict_a";
  const conflictConversationB = "conversation_draft_tools_conflict_b";
  const rollbackConversation = "conversation_draft_tools_rollback";
  const outlineId = captureStoryOutlineId("outline_draft_tools");
  const storyUnitId = captureStoryUnitId("story_unit_draft_tools");
  const statusTool = registry.require("NovelDraftStatus");
  const commitTool = registry.require("NovelDraftCommit");
  const rollbackTool = registry.require("NovelDraftRollback");
  const rebaseTool = registry.require("NovelDraftRebase");

  // Status without an active Draft.
  const emptyStatus = await statusTool.handler.execute(
    context(conversation, 1),
    {},
    progress,
  );
  assert.equal(emptyStatus.details.draft, undefined);

  // Create a Draft and write one story unit, then inspect status.
  const session = await drafts.startDraft(conversation);
  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: storyUnitId,
    outlineId,
    orderKey: "8000",
    title: "Draft unit",
    planningStatus: "idea",
    realizationStatus: "pending",
  }));
  const withDraft = await statusTool.handler.execute(
    context(conversation, 2),
    {},
    progress,
  );
  assert.equal(withDraft.details.draft.id, session.id);
  assert.equal(withDraft.details.draft.status, "active");
  assert.equal(withDraft.details.draft.baseRevision, session.baseRevision);

  // Commit the Draft to canonical state.
  const committed = await commitTool.handler.execute(
    context(conversation, 3),
    {},
    progress,
  );
  assert.equal(committed.details.status, "committed");
  assert.equal(committed.details.operationCount, 2);
  assert.ok(committed.details.resultRevision);
  const afterCommit = await statusTool.handler.execute(
    context(conversation, 4),
    {},
    progress,
  );
  assert.equal(afterCommit.details.draft, undefined);

  // Rebase when canonical has not advanced reports not_required.
  const freshSession = await drafts.startDraft(freshConversation);
  const notRequired = await rebaseTool.handler.execute(
    context(freshConversation, 5),
    {},
    progress,
  );
  assert.equal(notRequired.details.status, "not_required");

  // Conflicted rebase: two Drafts edit the same field, one commits first.
  const conflictA = await drafts.startDraft(conflictConversationA);
  const conflictB = await drafts.startDraft(conflictConversationB);
  const readA = await application.outlineQueries.getStoryUnit(
    draftNovelReadScope(conflictA),
    storyUnitId,
  );
  await application.outline.replaceStoryUnit(
    conflictA,
    storyUnitId,
    readA.contentDigest,
    {
      title: "Edited by A",
      planningStatus: readA.unit.planningStatus,
      realizationStatus: readA.unit.realizationStatus,
    },
  );
  const readB = await application.outlineQueries.getStoryUnit(
    draftNovelReadScope(conflictB),
    storyUnitId,
  );
  await application.outline.replaceStoryUnit(
    conflictB,
    storyUnitId,
    readB.contentDigest,
    {
      title: "Edited by B",
      planningStatus: readB.unit.planningStatus,
      realizationStatus: readB.unit.realizationStatus,
    },
  );
  await commitTool.handler.execute(
    context(conflictConversationA, 6),
    {},
    progress,
  );
  const conflicted = await rebaseTool.handler.execute(
    context(conflictConversationB, 7),
    {},
    progress,
  );
  assert.equal(conflicted.details.status, "conflicted");
  assert.ok(conflicted.details.conflictCount >= 1);
  assert.equal(conflicted.details.conflicts[0].kind, "field-modified");
  assert.equal(
    conflicted.details.conflicts[0].entityType,
    "story-unit",
  );

  // Rollback a fresh Draft.
  const rollbackSession = await drafts.startDraft(rollbackConversation);
  const rolledBack = await rollbackTool.handler.execute(
    context(rollbackConversation, 8),
    {},
    progress,
  );
  assert.equal(rolledBack.details.status, "rolled-back");
  assert.equal(rolledBack.details.draftId, rollbackSession.id);
  assert.equal((await statusTool.handler.execute(
    context(rollbackConversation, 9),
    {},
    progress,
  )).details.draft, undefined);
  console.log("novel draft tools smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
