import assert from "node:assert/strict";
import {
  StoryOutlineTreeController,
  captureStoryOutlineTreeView,
} from "../dist/index.js";

const view = createView();
const captured = captureStoryOutlineTreeView(view);
view.nodes.root.title = "mutated";
assert.equal(captured.nodes.root.title, "灯塔调查线");
assert.ok(Object.isFrozen(captured));
assert.ok(Object.isFrozen(captured.nodes));
assert.ok(Object.isFrozen(captured.nodes.root.childIds));

const controller = new StoryOutlineTreeController({
  view: captured,
  expandedIds: ["root", "branch"],
  selectedId: "root",
});
assert.deepEqual(
  controller.getSnapshot().visibleRows.map((row) => [row.id, row.depth]),
  [["root", 0], ["opening", 1], ["branch", 1], ["climax", 2]],
);
assert.equal(controller.getSnapshot().visibleRows[1].positionInSet, 1);
assert.equal(controller.getSnapshot().visibleRows[1].setSize, 2);

controller.selectNext();
assert.equal(controller.getSnapshot().selectedId, "opening");
controller.selectNext();
assert.equal(controller.getSnapshot().selectedId, "branch");
controller.selectFirstChild();
assert.equal(controller.getSnapshot().selectedId, "climax");
controller.selectParent();
assert.equal(controller.getSnapshot().selectedId, "branch");
controller.toggleSelected();
assert.deepEqual(
  controller.getSnapshot().visibleRows.map((row) => row.id),
  ["root", "opening", "branch"],
);
controller.selectPrevious();
assert.equal(controller.getSnapshot().selectedId, "opening");
controller.replaceView({
  ...createView(),
  nodes: {
    root: {
      ...createView().nodes.root,
      childIds: ["branch"],
      progress: { completedLeafCount: 0, totalLeafCount: 1 },
    },
    branch: {
      ...createView().nodes.branch,
      childIds: [],
      progress: { completedLeafCount: 0, totalLeafCount: 1 },
    },
  },
});
assert.equal(controller.getSnapshot().selectedId, undefined);
assert.deepEqual(controller.getSnapshot().expandedIds, ["root"]);

assert.throws(
  () =>
    captureStoryOutlineTreeView({
      ...createView(),
      rootIds: ["root", "climax"],
    }),
  /root is invalid/,
);
assert.throws(
  () =>
    captureStoryOutlineTreeView({
      ...createView(),
      nodes: {
        ...createView().nodes,
        root: { ...createView().nodes.root, parentId: "branch" },
      },
    }),
  /root is invalid|cycle/,
);

const largeView = createLargeView(10_000);
const largeController = new StoryOutlineTreeController({
  view: largeView,
  expandedIds: Object.keys(largeView.nodes).slice(0, -1),
});
assert.equal(largeController.getSnapshot().visibleRows.length, 10_000);
assert.equal(largeController.getSnapshot().visibleRows.at(-1).depth, 9_999);
console.log("story outline tree model smoke passed");

function createView() {
  return {
    outlineId: "outline-1",
    readScope: { kind: "canonical" },
    sourceRevision: "revision-1",
    rootIds: ["root"],
    nodes: {
      root: node({
        id: "root",
        title: "灯塔调查线",
        childIds: ["opening", "branch"],
        progress: { completedLeafCount: 1, totalLeafCount: 2 },
      }),
      opening: node({
        id: "opening",
        parentId: "root",
        title: "异常梦境",
        planningStatus: "ready",
        realizationStatus: "completed",
        progress: { completedLeafCount: 1, totalLeafCount: 1 },
      }),
      branch: node({
        id: "branch",
        parentId: "root",
        title: "进入白塔港",
        childIds: ["climax"],
        realizationStatus: "in-progress",
        blockState: { code: "missing-clue", label: "缺少关键线索" },
        progress: { completedLeafCount: 0, totalLeafCount: 1 },
      }),
      climax: node({
        id: "climax",
        parentId: "branch",
        title: "灯塔真相",
        progress: { completedLeafCount: 0, totalLeafCount: 1 },
      }),
    },
  };
}

function node(overrides) {
  return {
    id: overrides.id,
    ...(overrides.parentId === undefined ? {} : { parentId: overrides.parentId }),
    orderKey: `order:${overrides.id}`,
    childIds: overrides.childIds ?? [],
    title: overrides.title,
    scope: { code: "story-unit", label: "故事单元" },
    planningStatus: overrides.planningStatus ?? "outlined",
    realizationStatus: overrides.realizationStatus ?? "pending",
    ...(overrides.blockState === undefined ? {} : { blockState: overrides.blockState }),
    progress: overrides.progress,
  };
}

function createLargeView(size) {
  const nodes = {};
  for (let index = 0; index < size; index += 1) {
    const id = `unit-${index}`;
    nodes[id] = node({
      id,
      ...(index === 0 ? {} : { parentId: `unit-${index - 1}` }),
      title: `StoryUnit ${index}`,
      childIds: index + 1 < size ? [`unit-${index + 1}`] : [],
      progress: { completedLeafCount: 0, totalLeafCount: 1 },
    });
  }
  return {
    outlineId: "outline-large",
    readScope: { kind: "draft", draftSessionId: "draft-large" },
    sourceRevision: "revision-large",
    rootIds: ["unit-0"],
    nodes,
  };
}
