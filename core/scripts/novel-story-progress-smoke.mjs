import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  STORY_UNIT_ABANDON_REASON,
  STORY_UNIT_BLOCK_REASON,
  STORY_UNIT_PLANNING_STATUS,
  STORY_UNIT_REALIZATION_STATUS,
  StoryOutlineTree,
  captureNovelId,
  captureOrderKey,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
} from "../dist/index.js";

const outlineId = captureStoryOutlineId("outline_progress");
const outline = captureStoryOutline({
  id: outlineId,
  novelId: captureNovelId("novel_progress"),
});
const rootId = captureStoryUnitId("story_unit_progress_root");
const completedId = captureStoryUnitId("story_unit_progress_completed");
const blockedId = captureStoryUnitId("story_unit_progress_blocked");
const abandonedId = captureStoryUnitId("story_unit_progress_abandoned");
const timestamp = "2026-08-02T18:00:00.000Z";

const unit = (overrides) =>
  captureStoryUnit({
    id: rootId,
    outlineId,
    orderKey: captureOrderKey("8000"),
    title: "Progress unit",
    planningStatus: STORY_UNIT_PLANNING_STATUS.outlined,
    realizationStatus: STORY_UNIT_REALIZATION_STATUS.pending,
    ...overrides,
  });

const root = unit({ id: rootId, title: "Composite root" });
const completed = unit({
  id: completedId,
  parentId: rootId,
  orderKey: captureOrderKey("4000"),
  title: "Completed leaf",
  planningStatus: STORY_UNIT_PLANNING_STATUS.ready,
  realizationStatus: STORY_UNIT_REALIZATION_STATUS.completed,
});
const blocked = unit({
  id: blockedId,
  parentId: rootId,
  orderKey: captureOrderKey("8000"),
  title: "Blocked leaf",
  planningStatus: STORY_UNIT_PLANNING_STATUS.ready,
  realizationStatus: STORY_UNIT_REALIZATION_STATUS.inProgress,
  blockState: {
    reasonCode: STORY_UNIT_BLOCK_REASON.decisionRequired,
    note: "Author decision is required.",
    dependencyIds: [completedId],
    blockedAt: timestamp,
  },
});
const abandoned = unit({
  id: abandonedId,
  parentId: rootId,
  orderKey: captureOrderKey("C000"),
  title: "Abandoned leaf",
  realizationStatus: STORY_UNIT_REALIZATION_STATUS.abandoned,
  abandonment: {
    reasonCode: STORY_UNIT_ABANDON_REASON.scopeReduced,
    note: "The branch no longer serves the current direction.",
    abandonedAt: timestamp,
  },
});
const tree = new StoryOutlineTree({
  outline,
  units: [blocked, abandoned, completed, root],
});

assert.deepEqual(tree.getProgress(rootId), {
  storyUnitId: rootId,
  effectiveStatus: STORY_UNIT_REALIZATION_STATUS.inProgress,
  isBlocked: false,
  isDirectlyBlocked: false,
  isBlockedByAncestor: false,
  blockedLeafCount: 1,
  completedLeafCount: 1,
  totalLeafCount: 2,
});
assert.deepEqual(tree.getProgress(blockedId), {
  storyUnitId: blockedId,
  effectiveStatus: STORY_UNIT_REALIZATION_STATUS.inProgress,
  isBlocked: true,
  isDirectlyBlocked: true,
  isBlockedByAncestor: false,
  blockedLeafCount: 1,
  completedLeafCount: 0,
  totalLeafCount: 1,
});
assert.equal(tree.getProgress(abandonedId).effectiveStatus, "abandoned");
assert.equal(tree.getProgress(abandonedId).totalLeafCount, 0);

const blockedRoot = unit({
  ...root,
  blockState: {
    reasonCode: STORY_UNIT_BLOCK_REASON.outlineIncomplete,
    dependencyIds: [],
    blockedAt: timestamp,
  },
});
const blockedTree = new StoryOutlineTree({
  outline,
  units: [blockedRoot, completed, unit({ ...blocked, blockState: undefined })],
});
assert.equal(blockedTree.getProgress(rootId).blockedLeafCount, 2);
assert.equal(blockedTree.getProgress(blockedId).isBlockedByAncestor, true);

const abandonedRoot = unit({
  ...root,
  realizationStatus: STORY_UNIT_REALIZATION_STATUS.abandoned,
  abandonment: {
    reasonCode: STORY_UNIT_ABANDON_REASON.storyDirectionChanged,
    abandonedAt: timestamp,
  },
});
const abandonedTree = new StoryOutlineTree({
  outline,
  units: [abandonedRoot, completed, blocked],
});
assert.equal(abandonedTree.getProgress(rootId).effectiveStatus, "abandoned");
assert.equal(abandonedTree.getProgress(rootId).totalLeafCount, 0);
assert.equal(abandonedTree.getProgress(completedId).effectiveStatus, "abandoned");

for (const invalid of [
  {
    ...root,
    realizationStatus: STORY_UNIT_REALIZATION_STATUS.completed,
    blockState: blocked.blockState,
  },
  {
    ...root,
    realizationStatus: STORY_UNIT_REALIZATION_STATUS.abandoned,
  },
  {
    ...root,
    abandonment: abandoned.abandonment,
  },
  {
    ...abandoned,
    blockState: blocked.blockState,
  },
]) {
  assertProtocolFailure(() => captureStoryUnit(invalid));
}

assertProtocolFailure(() =>
  new StoryOutlineTree({
    outline,
    units: [
      root,
      unit({
        ...blocked,
        blockState: {
          ...blocked.blockState,
          dependencyIds: [blockedId],
        },
      }),
    ],
  }),
);
assertProtocolFailure(() =>
  new StoryOutlineTree({
    outline,
    units: [
      unit({
        ...abandonedRoot,
        abandonment: {
          ...abandonedRoot.abandonment,
          replacementStoryUnitId: completedId,
        },
      }),
      completed,
    ],
  }),
);

console.log("novel story progress smoke passed");

function assertProtocolFailure(invoke) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(
      [
        NOVEL_PROTOCOL_FAILURE.invalidStoryUnit,
        NOVEL_PROTOCOL_FAILURE.invalidStoryOutline,
      ].includes(error.failure),
      true,
    );
    return true;
  });
}
