import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  NovelDraftSessionService,
  STORY_SETTING_MODE,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLeafStoryUnitPlan,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
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

class DraftIdentityFactory {
  createDraftSessionId() {
    return "draft_outline_application";
  }
}

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
      new Date(Date.UTC(2026, 7, 3, 10, 0, 0, this.offset++)).toISOString(),
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

const root = await mkdtemp(join(tmpdir(), "novel-outline-application-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_outline_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: new DraftIdentityFactory(),
    clock,
    logger,
  });
  const session = await drafts.startDraft("conversation-outline-application");
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  assert.equal(
    await application.outlineQueries.getOutline(canonicalNovelReadScope),
    undefined,
  );

  const outlineId = captureStoryOutlineId("outline_application");
  const rootId = captureStoryUnitId("story_unit_application_root");
  const leafId = captureStoryUnitId("story_unit_application_leaf");
  const characterId = captureCharacterId("character_application_protagonist");
  const orderKeys = new FractionalOrderKeyFactory();
  const rootOrder = orderKeys.initial();
  const leafOrder = orderKeys.initial();
  const forbiddenTitle = "FORBIDDEN_OUTLINE_TITLE";
  const forbiddenCharacter = "FORBIDDEN_CHARACTER_PROFILE";
  const draftScope = draftNovelReadScope(session);

  await application.characters.create(session, characterId, {
    name: forbiddenCharacter,
    aliases: [],
  });
  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: rootId,
    outlineId,
    orderKey: rootOrder,
    title: "Root arc",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }));
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: leafId,
    outlineId,
    parentId: rootId,
    orderKey: leafOrder,
    title: "Initial leaf",
    intent: "This value is removed by overwrite.",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }));

  const beforeReplace = await application.outlineQueries.getStoryUnit(
    draftScope,
    leafId,
  );
  assert.equal(Object.isFrozen(beforeReplace), true);
  await application.outline.replaceStoryUnit(
    session,
    leafId,
    beforeReplace.contentDigest,
    {
      title: forbiddenTitle,
      planningStatus: "ready",
      realizationStatus: "in-progress",
    },
  );
  const beforeMove = await application.outlineQueries.getStoryUnit(
    draftScope,
    leafId,
  );
  assert.equal(beforeMove.unit.intent, undefined);
  await application.outline.moveStoryUnit(session, {
    storyUnitId: leafId,
    expectedParentDigest: beforeMove.parentDigest,
    expectedOrderDigest: beforeMove.orderDigest,
    orderKey: orderKeys.after(rootOrder),
  });

  const plan = captureLeafStoryUnitPlan({
    storyUnitId: leafId,
    settingMode: STORY_SETTING_MODE.locationIndependent,
    characters: [{ storyUnitId: leafId, characterId }],
    locations: [],
    events: [],
    rhythmBeats: [],
    entityChanges: [],
  });
  await application.outline.replaceLeafStoryUnitPlan(session, plan);
  const draftTree = await application.outlineQueries.getTree(draftScope);
  assert.equal(draftTree.listRoots().length, 2);
  assert.equal(draftTree.getUnit(leafId).title, forbiddenTitle);
  const draftPlan = await application.outlineQueries.getLeafStoryUnitPlan(
    draftScope,
    leafId,
  );
  assert.equal(Object.isFrozen(draftPlan), true);
  assert.deepEqual(draftPlan.plan, plan);
  const changeSet = await application.changeSets.build(session);
  assert.equal(changeSet.operationCount, 7);

  const resultRevision = captureNovelRevision("revision_outline_committed");
  const committed = await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_outline_application"),
    resultRevision,
    committedAt: captureNovelTimestamp("2026-08-03T10:30:00.000Z"),
  });
  assert.equal(committed.status, "committed");
  assert.equal(committed.commit.changeSetDigest, changeSet.digest);
  assert.equal((await canonicalStore.getMetadata()).currentRevision, resultRevision);

  const canonicalTree = await application.outlineQueries.getTree(
    canonicalNovelReadScope,
  );
  assert.equal(canonicalTree.getUnit(leafId).title, forbiddenTitle);
  assert.equal(canonicalTree.getUnit(leafId).parentId, undefined);
  assert.deepEqual(
    (await application.outlineQueries.getLeafStoryUnitPlan(
      canonicalNovelReadScope,
      leafId,
    )).plan,
    plan,
  );
  assert.equal(
    (await application.characterQueries.get(
      canonicalNovelReadScope,
      characterId,
    )).name,
    forbiddenCharacter,
  );

  const restarted = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  assert.equal(
    (await restarted.outlineQueries.getStoryUnit(
      canonicalNovelReadScope,
      leafId,
    )).unit.title,
    forbiddenTitle,
  );
  assertRedacted(logs, [root, forbiddenTitle, forbiddenCharacter]);

  console.log("novel outline application smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
