import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  StoryOutlineTree,
  StoryOutlineTreeController,
} from "../dist/index.js";

const ROOT_COUNT = 240;
const CHILDREN_PER_ROOT = 5;
const EXPECTED_ROWS = ROOT_COUNT * (1 + CHILDREN_PER_ROOT);

installDom();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
const { view, rootIds } = createLargeView();
const controller = new StoryOutlineTreeController({
  view,
  expandedIds: rootIds,
});

const started = performance.now();
await act(async () => {
  root.render(createElement(StoryOutlineTree, { controller }));
});
const elapsed = performance.now() - started;
assert.ok(
  elapsed < 5_000,
  `large outline tree render took ${elapsed.toFixed(0)}ms`,
);
assert.equal(controller.getSnapshot().visibleRows.length, EXPECTED_ROWS);
assert.equal(
  container.querySelectorAll('[role="treeitem"]').length,
  EXPECTED_ROWS,
);

const firstRootRow = container.querySelector('[role="treeitem"]');
assert.equal(firstRootRow.getAttribute("aria-expanded"), "true");
await act(async () => {
  container.querySelector(".novel-outline-toggle").click();
});
assert.equal(
  controller.getSnapshot().visibleRows.length,
  EXPECTED_ROWS - CHILDREN_PER_ROOT,
);

await act(async () => {
  firstRootRow.focus();
  firstRootRow.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await Promise.resolve();
});
assert.equal(
  controller.getSnapshot().selectedId,
  controller.getSnapshot().visibleRows[1]?.id,
);

await act(async () => root.unmount());
console.log("story outline large tree smoke passed");

function createLargeView() {
  const nodes = {};
  const rootIds = [];
  for (let rootIndex = 0; rootIndex < ROOT_COUNT; rootIndex += 1) {
    const rootId = `root_${rootIndex}`;
    rootIds.push(rootId);
    const childIds = [];
    for (
      let childIndex = 0;
      childIndex < CHILDREN_PER_ROOT;
      childIndex += 1
    ) {
      const childId = `unit_${rootIndex}_${childIndex}`;
      childIds.push(childId);
      nodes[childId] = node({
        id: childId,
        parentId: rootId,
        title: `故事单元 ${rootIndex}-${childIndex}`,
      });
    }
    nodes[rootId] = node({
      id: rootId,
      title: `主线 ${rootIndex}`,
      childIds,
    });
  }
  return {
    view: {
      outlineId: "outline-large",
      readScope: { kind: "canonical" },
      sourceRevision: "revision-large",
      rootIds,
      nodes,
    },
    rootIds,
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
    planningStatus: "ready",
    realizationStatus: "pending",
    progress: { completedLeafCount: 0, totalLeafCount: 1 },
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
