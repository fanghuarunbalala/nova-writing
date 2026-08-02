import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  FractionalOrderKeyFactory,
  NovelProtocolValidationError,
  RandomStoryIdentityFactory,
  STORY_UNIT_SCOPE,
  StoryOutlineTree,
  captureNovelId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
} from "../dist/index.js";

const generatedIdentities = new RandomStoryIdentityFactory();
assert.match(generatedIdentities.createStoryOutlineId(), /^outline_[a-f0-9]{32}$/u);
assert.match(generatedIdentities.createStoryUnitId(), /^story_unit_[a-f0-9]{32}$/u);

const outlineId = captureStoryOutlineId("outline_main");
const outline = captureStoryOutline({
  id: outlineId,
  novelId: captureNovelId("novel_outline_smoke"),
});
assert.equal(Object.isFrozen(outline), true);

const orderKeys = new FractionalOrderKeyFactory();
const rootFirstId = captureStoryUnitId("story_unit_root_first");
const rootSecondId = captureStoryUnitId("story_unit_root_second");
const childFirstId = captureStoryUnitId("story_unit_child_first");
const childSecondId = captureStoryUnitId("story_unit_child_second");
const rootFirstKey = orderKeys.before(orderKeys.initial());
const rootSecondKey = orderKeys.after(rootFirstKey);
const childFirstKey = orderKeys.initial();
const childSecondKey = orderKeys.after(childFirstKey);

const rootFirst = captureStoryUnit({
  id: rootFirstId,
  outlineId,
  orderKey: rootFirstKey,
  title: "Opening arc",
  intent: "Establish the central promise.",
  synopsis: "The protagonist enters the story problem.",
  scope: STORY_UNIT_SCOPE.arc,
  planningStatus: "outlined",
  realizationStatus: "pending",
});
const rootSecond = captureStoryUnit({
  id: rootSecondId,
  outlineId,
  orderKey: rootSecondKey,
  title: "Escalation arc",
  planningStatus: "idea",
  realizationStatus: "pending",
});
const childFirst = captureStoryUnit({
  id: childFirstId,
  outlineId,
  parentId: rootFirstId,
  orderKey: childFirstKey,
  title: "First encounter",
  scope: STORY_UNIT_SCOPE.scene,
  planningStatus: "ready",
  realizationStatus: "pending",
});
const childSecond = captureStoryUnit({
  id: childSecondId,
  outlineId,
  parentId: rootFirstId,
  orderKey: childSecondKey,
  title: "First consequence",
  scope: STORY_UNIT_SCOPE.sequence,
  planningStatus: "outlined",
  realizationStatus: "pending",
});
assert.equal(Object.isFrozen(rootFirst), true);

const tree = new StoryOutlineTree({
  outline,
  units: [childSecond, rootSecond, childFirst, rootFirst],
});
assert.equal(Object.isFrozen(tree.getSnapshot()), true);
assert.equal(Object.isFrozen(tree.getSnapshot().units), true);
assert.deepEqual(tree.listRoots().map((unit) => unit.id), [
  rootFirstId,
  rootSecondId,
]);
assert.deepEqual(tree.listChildren(rootFirstId).map((unit) => unit.id), [
  childFirstId,
  childSecondId,
]);
assert.deepEqual(tree.listDepthFirst().map((unit) => unit.id), [
  rootFirstId,
  childFirstId,
  childSecondId,
  rootSecondId,
]);
assert.deepEqual(tree.getUnit(childFirstId), childFirst);
assert.equal(tree.getUnit(captureStoryUnitId("story_unit_missing")), undefined);
assert.deepEqual(tree.listChildren(rootSecondId), []);

const sameKeyUnderDifferentParents = new StoryOutlineTree({
  outline,
  units: [
    rootFirst,
    rootSecond,
    childFirst,
    captureStoryUnit({
      ...childSecond,
      orderKey: childFirst.orderKey,
      parentId: rootSecondId,
    }),
  ],
});
assert.deepEqual(sameKeyUnderDifferentParents.listChildren(rootSecondId), [
  sameKeyUnderDifferentParents.getUnit(childSecondId),
]);

for (const invalidUnit of [
  { ...rootFirst, title: " leading" },
  { ...rootFirst, title: "" },
  { ...rootFirst, scope: "chapter" },
  { ...rootFirst, unknown: true },
]) {
  assertProtocolFailure(
    () => captureStoryUnit(invalidUnit),
    NOVEL_PROTOCOL_FAILURE.invalidStoryUnit,
    "storyUnit",
  );
}
assertProtocolFailure(
  () => captureStoryOutline({ ...outline, unknown: true }),
  NOVEL_PROTOCOL_FAILURE.invalidStoryOutline,
  "storyOutline",
);

for (const invalidTree of [
  { outline, units: [rootFirst, rootFirst] },
  {
    outline,
    units: [
      rootFirst,
      captureStoryUnit({ ...rootSecond, outlineId: "outline_other" }),
    ],
  },
  {
    outline,
    units: [
      rootFirst,
      captureStoryUnit({ ...childFirst, parentId: "story_unit_missing" }),
    ],
  },
  {
    outline,
    units: [rootFirst, captureStoryUnit({ ...rootSecond, orderKey: rootFirstKey })],
  },
  {
    outline,
    units: [
      captureStoryUnit({
        ...rootFirst,
        parentId: rootSecondId,
      }),
      captureStoryUnit({
        ...rootSecond,
        parentId: rootFirstId,
      }),
    ],
  },
  { outline, units: [captureStoryUnit({ ...rootFirst, parentId: rootFirstId })] },
  { outline, units: [], unknown: true },
]) {
  assertProtocolFailure(
    () => new StoryOutlineTree(invalidTree),
    NOVEL_PROTOCOL_FAILURE.invalidStoryOutline,
    "storyOutline",
  );
}

console.log("novel story outline smoke passed");

function assertProtocolFailure(invoke, failure, field) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, failure);
    assert.equal(error.field, field);
    assert.equal(error.message, "Novel protocol validation failed");
    return true;
  });
}
