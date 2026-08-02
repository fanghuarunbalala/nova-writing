import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  StoryOutlineTree,
  StoryOutlineTreeController,
} from "../dist/index.js";

const controller = new StoryOutlineTreeController({
  view: createView(),
  expandedIds: ["root"],
  selectedId: "root",
});
const markup = renderToStaticMarkup(
  createElement(StoryOutlineTree, { controller }),
);
assert.match(markup, /role="tree"/);
assert.match(markup, /role="treeitem"/);
assert.match(markup, /aria-level="2"/);
assert.match(markup, /可写/);
assert.match(markup, /进行中/);
assert.match(markup, /阻塞/);
assert.match(markup, /1\/2/);

installDom();
const selections = [];
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(StoryOutlineTree, {
      controller,
      onSelect: (id) => selections.push(id),
    }),
  );
});
assert.equal(container.querySelectorAll('[role="treeitem"]').length, 3);
const rootRow = container.querySelector('[role="treeitem"]');
await act(async () => {
  rootRow.focus();
  rootRow.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await Promise.resolve();
});
assert.equal(controller.getSnapshot().selectedId, "opening");
assert.equal(selections.at(-1), "opening");
assert.match(document.activeElement.textContent, /异常梦境/);

const openingRow = [...container.querySelectorAll('[role="treeitem"]')].find(
  (row) => row.textContent.includes("异常梦境"),
);
await act(async () => {
  openingRow.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
});
assert.equal(controller.getSnapshot().selectedId, "root");

await act(async () => {
  rootRow.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
  );
});
assert.equal(controller.getSnapshot().visibleRows.length, 1);
assert.equal(rootRow.getAttribute("aria-expanded"), "false");

const toggle = container.querySelector(".novel-outline-toggle");
await act(async () => toggle.click());
assert.equal(controller.getSnapshot().visibleRows.length, 3);
assert.equal(container.querySelector('[role="treeitem"]').getAttribute("aria-expanded"), "true");

await act(async () => root.unmount());
console.log("story outline tree smoke passed");

function createView() {
  return {
    outlineId: "outline-ui",
    readScope: { kind: "draft", draftSessionId: "draft-ui" },
    sourceRevision: "revision-ui",
    rootIds: ["root"],
    nodes: {
      root: node({
        id: "root",
        title: "灯塔调查线",
        childIds: ["opening", "climax"],
        planningStatus: "outlined",
        realizationStatus: "in-progress",
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
      climax: node({
        id: "climax",
        parentId: "root",
        title: "灯塔真相",
        planningStatus: "ready",
        realizationStatus: "pending",
        blockState: { code: "missing-clue", label: "缺少关键线索" },
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
    planningStatus: overrides.planningStatus,
    realizationStatus: overrides.realizationStatus,
    ...(overrides.blockState === undefined ? {} : { blockState: overrides.blockState }),
    progress: overrides.progress,
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
