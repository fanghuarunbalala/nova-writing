import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  OutlineChangeReviewer,
  captureOutlineTreeDiffView,
} from "../dist/index.js";

const captured = captureOutlineTreeDiffView(createView());
assert.ok(Object.isFrozen(captured));
assert.ok(Object.isFrozen(captured.rows));
assert.throws(
  () =>
    captureOutlineTreeDiffView({
      rootRowIds: ["before"],
      rows: { before: row({ rowId: "before", storyUnitId: "unit-1", diffKind: "modified-before", changeId: "change-1" }) },
    }),
  /pair/,
);
assert.throws(
  () =>
    captureOutlineTreeDiffView({
      rootRowIds: ["move"],
      rows: { move: row({ rowId: "move", storyUnitId: "unit-1", diffKind: "moved", changeId: "move-1" }) },
    }),
  /move paths/,
);

const markup = renderToStaticMarkup(createElement(OutlineChangeReviewer, { view: captured }));
for (const kind of ["added", "deleted", "modified-before", "modified-after", "moved", "unchanged"]) {
  assert.match(markup, new RegExp(`data-diff-kind="${kind}"`));
}
assert.match(markup, /旧高潮/);
assert.match(markup, /新高潮/);
assert.match(markup, /旧章节 › 港口 → 新章节 › 灯塔/);

installDom();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => root.render(createElement(OutlineChangeReviewer, { view: captured })));
assert.equal(container.querySelectorAll('[role="treeitem"]').length, 6);
const firstRow = container.querySelector('[role="treeitem"]');
await act(async () => {
  firstRow.focus();
  firstRow.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await Promise.resolve();
});
assert.match(document.activeElement.textContent, /新增线索/);
const toggle = container.querySelector(".novel-outline-diff-toggle");
await act(async () => toggle.click());
assert.equal(container.querySelectorAll('[role="treeitem"]').length, 1);
await act(async () => toggle.click());
assert.equal(container.querySelectorAll('[role="treeitem"]').length, 6);
await act(async () => root.unmount());
console.log("outline change reviewer smoke passed");

function createView() {
  return {
    rootRowIds: ["context"],
    rows: {
      context: row({
        rowId: "context",
        storyUnitId: "unit-root",
        diffKind: "unchanged",
        title: "灯塔调查线",
        childRowIds: ["added", "deleted", "before", "after", "moved"],
      }),
      added: row({ rowId: "added", storyUnitId: "unit-added", parentRowId: "context", diffKind: "added", changeId: "change-added", title: "新增线索" }),
      deleted: row({ rowId: "deleted", storyUnitId: "unit-deleted", parentRowId: "context", diffKind: "deleted", changeId: "change-deleted", title: "删除支线" }),
      before: row({ rowId: "before", storyUnitId: "unit-climax", parentRowId: "context", diffKind: "modified-before", changeId: "change-climax", title: "旧高潮" }),
      after: row({ rowId: "after", storyUnitId: "unit-climax", parentRowId: "context", diffKind: "modified-after", changeId: "change-climax", title: "新高潮" }),
      moved: row({
        rowId: "moved",
        storyUnitId: "unit-moved",
        parentRowId: "context",
        diffKind: "moved",
        changeId: "change-moved",
        title: "调查转折",
        sourcePath: ["旧章节", "港口"],
        targetPath: ["新章节", "灯塔"],
      }),
    },
  };
}

function row(overrides) {
  return {
    rowId: overrides.rowId,
    storyUnitId: overrides.storyUnitId,
    ...(overrides.parentRowId === undefined ? {} : { parentRowId: overrides.parentRowId }),
    childRowIds: overrides.childRowIds ?? [],
    diffKind: overrides.diffKind,
    ...(overrides.changeId === undefined ? {} : { changeId: overrides.changeId }),
    title: overrides.title ?? overrides.rowId,
    scope: { code: "story-unit", label: "故事单元" },
    planningStatus: "outlined",
    realizationStatus: "pending",
    progress: { completedLeafCount: 0, totalLeafCount: 1 },
    ...(overrides.sourcePath === undefined ? {} : { sourcePath: overrides.sourcePath }),
    ...(overrides.targetPath === undefined ? {} : { targetPath: overrides.targetPath }),
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
