import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  NovelDraftSessionService,
  NovelRevisionConflictError,
  STORY_SETTING_MODE,
  canonicalNovelReadScope,
  canonicalizeNovelConflictResolutionRecord,
  captureLeafStoryUnitPlan,
  captureNovelConflictResolutionRecord,
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
  digestNovelConflictText,
} from "../dist/node/index.js";

class DraftIdentityFactory {
  sequence = 0;
  createDraftSessionId() {
    this.sequence += 1;
    return `draft_outline_rebase_${this.sequence}`;
  }
}

class FixedRevisionFactory {
  constructor(value) { this.value = captureNovelRevision(value); }
  createRevision() { return this.value; }
}

class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 12, 0, 0, this.offset++)).toISOString(),
    );
  }
}

const keepDraftPlanner = Object.freeze({
  async planKeepDraft() {
    throw new Error("keep-draft is not used by this scenario");
  },
});

const root = await mkdtemp(join(tmpdir(), "novel-outline-rebase-"));
const workspaceRoot = join(root, "workspace");
let canonicalStore;
let draftStore;
let rebaseServices;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_outline_rebase_initial"),
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
  });
  const clock = new SequenceClock();
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
  });
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new DraftIdentityFactory(),
    clock,
  });
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
  });
  const orderKeys = new FractionalOrderKeyFactory();
  const outlineId = captureStoryOutlineId("outline_rebase");
  const fieldId = captureStoryUnitId("story_unit_rebase_field");
  const parentAId = captureStoryUnitId("story_unit_rebase_parent_a");
  const parentBId = captureStoryUnitId("story_unit_rebase_parent_b");
  const parentMoveId = captureStoryUnitId("story_unit_rebase_parent_move");
  const orderMoveId = captureStoryUnitId("story_unit_rebase_order_move");
  const deleteId = captureStoryUnitId("story_unit_rebase_delete");
  const domainId = captureStoryUnitId("story_unit_rebase_domain");
  const createdId = captureStoryUnitId("story_unit_rebase_created");
  const domainChildId = captureStoryUnitId("story_unit_rebase_domain_child");
  const safeId = captureStoryUnitId("story_unit_rebase_safe");

  const rootOrders = [];
  let currentOrder = orderKeys.initial();
  for (let index = 0; index < 12; index += 1) {
    rootOrders.push(currentOrder);
    currentOrder = orderKeys.after(currentOrder);
  }

  const setup = await drafts.startDraft("conversation-outline-rebase-setup");
  await application.outline.createOutline(setup, outlineId);
  const baseUnits = [
    [fieldId, rootOrders[0], "Field target"],
    [parentAId, rootOrders[1], "Parent A"],
    [parentBId, rootOrders[2], "Parent B"],
    [orderMoveId, rootOrders[3], "Order target"],
    [deleteId, rootOrders[4], "Delete target"],
    [domainId, rootOrders[5], "Domain target"],
  ];
  for (const [id, orderKey, title] of baseUnits) {
    await application.outline.createStoryUnit(setup, captureStoryUnit({
      id,
      outlineId,
      orderKey,
      title,
      planningStatus: "outlined",
      realizationStatus: "pending",
    }));
  }
  await application.outline.createStoryUnit(setup, captureStoryUnit({
    id: parentMoveId,
    outlineId,
    parentId: parentAId,
    orderKey: orderKeys.initial(),
    title: "Parent move target",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }));
  await application.commits.commit(setup, {
    commitId: captureNovelCommitId("commit_outline_rebase_setup"),
    resultRevision: captureNovelRevision("revision_outline_rebase_base"),
    committedAt: clock.now(),
  });

  const source = await drafts.startDraft("conversation-outline-rebase-source");
  const committer = await drafts.startDraft("conversation-outline-rebase-committer");
  const sourceScope = draftNovelReadScope(source);
  const committerScope = draftNovelReadScope(committer);

  const sourceField = await application.outlineQueries.getStoryUnit(sourceScope, fieldId);
  await application.outline.replaceStoryUnit(
    source,
    fieldId,
    sourceField.contentDigest,
    {
      title: "Source field change",
      planningStatus: "ready",
      realizationStatus: "in-progress",
    },
  );
  const sourceParentMove = await application.outlineQueries.getStoryUnit(
    sourceScope,
    parentMoveId,
  );
  await application.outline.moveStoryUnit(source, {
    storyUnitId: parentMoveId,
    expectedParentDigest: sourceParentMove.parentDigest,
    expectedOrderDigest: sourceParentMove.orderDigest,
    parentId: parentBId,
    orderKey: orderKeys.initial(),
  });
  const sourceOrderMove = await application.outlineQueries.getStoryUnit(
    sourceScope,
    orderMoveId,
  );
  await application.outline.moveStoryUnit(source, {
    storyUnitId: orderMoveId,
    expectedParentDigest: sourceOrderMove.parentDigest,
    expectedOrderDigest: sourceOrderMove.orderDigest,
    orderKey: rootOrders[8],
  });
  await application.outline.createStoryUnit(source, captureStoryUnit({
    id: createdId,
    outlineId,
    orderKey: rootOrders[6],
    title: "Source creates entity",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }));
  const sourceDelete = await application.outlineQueries.getStoryUnit(sourceScope, deleteId);
  await application.outline.replaceStoryUnit(
    source,
    deleteId,
    sourceDelete.contentDigest,
    {
      title: "Source edits deleted entity",
      planningStatus: "ready",
      realizationStatus: "in-progress",
    },
  );
  await application.outline.createStoryUnit(source, captureStoryUnit({
    id: domainChildId,
    outlineId,
    parentId: domainId,
    orderKey: orderKeys.initial(),
    title: "Source domain child",
    planningStatus: "idea",
    realizationStatus: "pending",
  }));
  await application.outline.createStoryUnit(source, captureStoryUnit({
    id: safeId,
    outlineId,
    orderKey: rootOrders[10],
    title: "Source non-conflicting unit",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }));

  const canonicalField = await application.outlineQueries.getStoryUnit(
    committerScope,
    fieldId,
  );
  await application.outline.replaceStoryUnit(
    committer,
    fieldId,
    canonicalField.contentDigest,
    {
      title: "Canonical field change",
      planningStatus: "ready",
      realizationStatus: "in-progress",
    },
  );
  const canonicalParentMove = await application.outlineQueries.getStoryUnit(
    committerScope,
    parentMoveId,
  );
  await application.outline.moveStoryUnit(committer, {
    storyUnitId: parentMoveId,
    expectedParentDigest: canonicalParentMove.parentDigest,
    expectedOrderDigest: canonicalParentMove.orderDigest,
    orderKey: rootOrders[7],
  });
  const canonicalOrderMove = await application.outlineQueries.getStoryUnit(
    committerScope,
    orderMoveId,
  );
  await application.outline.moveStoryUnit(committer, {
    storyUnitId: orderMoveId,
    expectedParentDigest: canonicalOrderMove.parentDigest,
    expectedOrderDigest: canonicalOrderMove.orderDigest,
    orderKey: rootOrders[9],
  });
  await application.outline.createStoryUnit(committer, captureStoryUnit({
    id: createdId,
    outlineId,
    orderKey: rootOrders[6],
    title: "Canonical creates entity",
    planningStatus: "ready",
    realizationStatus: "pending",
  }));
  const canonicalDelete = await application.outlineQueries.getStoryUnit(
    committerScope,
    deleteId,
  );
  await application.outline.deleteStoryUnit(committer, {
    storyUnitId: deleteId,
    expectedContentDigest: canonicalDelete.contentDigest,
    expectedParentDigest: canonicalDelete.parentDigest,
    expectedOrderDigest: canonicalDelete.orderDigest,
  });
  await application.outline.replaceLeafStoryUnitPlan(
    committer,
    captureLeafStoryUnitPlan({
      storyUnitId: domainId,
      settingMode: STORY_SETTING_MODE.locationIndependent,
      characters: [],
      locations: [],
      events: [],
      rhythmBeats: [],
      entityChanges: [],
    }),
  );
  await application.commits.commit(committer, {
    commitId: captureNovelCommitId("commit_outline_rebase_committer"),
    resultRevision: captureNovelRevision("revision_outline_rebase_canonical"),
    committedAt: clock.now(),
  });

  await assert.rejects(
    application.commits.commit(source, {
      commitId: captureNovelCommitId("commit_outline_rebase_stale"),
      resultRevision: captureNovelRevision("revision_outline_rebase_stale"),
      committedAt: clock.now(),
    }),
    NovelRevisionConflictError,
  );

  rebaseServices = await application.openRebase({
    canonicalStore,
    draftStore,
    snapshotter,
    keepDraftPlanner,
  });
  const result = await rebaseServices.rebases.prepareCandidate(source.id);
  assert.equal(result.conflicts.length, 6);
  assert.equal(result.candidate.operationCount, 1);
  assert.deepEqual(
    result.conflicts.map(({ conflict }) => [conflict.kind, conflict.fieldPath ?? null]),
    [
      ["field-modified", "content"],
      ["parent-changed", "parentId"],
      ["order-changed", "orderKey"],
      ["entity-created", null],
      ["entity-deleted", null],
      ["domain-invariant", null],
    ],
  );
  for (const { conflict } of result.conflicts) {
    assert.notEqual(conflict.canonicalDigest, conflict.draftDigest);
  }
  assert.deepEqual(
    await rebaseServices.conflictStore.listConflicts(result.candidate.session),
    result.conflicts,
  );
  assert.deepEqual(
    await rebaseServices.candidateStore.getCandidate(
      canonical.novelId,
      result.candidate.session.id,
    ),
    result.candidate,
  );

  for (const { conflict } of result.conflicts) {
    const resolution = captureNovelConflictResolutionRecord({
      resolutionVersion: 1,
      draftSessionId: result.candidate.session.id,
      conflictId: conflict.id,
      resolution: { strategy: "keep-canonical" },
      resolvedAt: clock.now(),
    });
    assert.equal(
      await rebaseServices.conflictStore.resolveConflict(
        result.candidate.session,
        resolution,
        digestNovelConflictText(
          canonicalizeNovelConflictResolutionRecord(resolution),
        ),
      ),
      "resolved",
    );
  }
  const planned = await rebaseServices.resolutionPlans.buildAndSave(
    result.candidate,
  );
  assert.equal(planned.status, "recorded");
  assert.equal(planned.plan.effectiveOperationCount, 1);

  await rebaseServices.close();
  rebaseServices = await application.openRebase({
    canonicalStore,
    draftStore,
    snapshotter,
    keepDraftPlanner,
  });
  assert.deepEqual(
    await rebaseServices.planStore.getPlan(result.candidate.session),
    planned.plan,
  );
  const resolved = await rebaseServices.resolvedRebases
    .prepareResolvedCandidate(result.candidate);
  assert.equal(resolved.operationCount, 1);

  await rebaseServices.close();
  rebaseServices = await application.openRebase({
    canonicalStore,
    draftStore,
    snapshotter,
    keepDraftPlanner,
  });
  assert.deepEqual(
    await rebaseServices.resolvedCandidateStore.getResolvedCandidate(
      canonical.novelId,
      resolved.session.id,
    ),
    resolved,
  );
  const promoted = await rebaseServices.promotions.promote(resolved);
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.promotion.session.status, "active");
  assert.equal(
    (
      await draftStore.getActiveDraftSession(
        canonical.novelId,
        source.ownerConversationId,
      )
    ).id,
    resolved.session.id,
  );
  assert.equal(
    (await rebaseServices.promotions.promote(resolved)).status,
    "duplicate",
  );
  await application.commits.commit(promoted.promotion.session, {
    commitId: captureNovelCommitId("commit_outline_rebase_resolved"),
    resultRevision: captureNovelRevision("revision_outline_rebase_resolved"),
    committedAt: clock.now(),
  });
  assert.equal(
    (await canonicalStore.getMetadata()).currentRevision,
    "revision_outline_rebase_resolved",
  );
  assert.equal(
    (
      await application.outlineQueries.getStoryUnit(
        canonicalNovelReadScope,
        safeId,
      )
    ).unit.title,
    "Source non-conflicting unit",
  );

  await canonicalStore.close();
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_unused_after_restart"),
  });
  assert.equal(
    (await canonicalStore.getMetadata()).currentRevision,
    "revision_outline_rebase_resolved",
  );

  console.log("novel outline rebase smoke passed");
} finally {
  await rebaseServices?.close();
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
