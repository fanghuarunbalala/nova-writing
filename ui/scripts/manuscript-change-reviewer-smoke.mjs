import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  ManuscriptChangeReviewer,
  captureManuscriptBlockDiffView,
} from "../dist/index.js";

const captured = captureManuscriptBlockDiffView(createView());
assert.ok(Object.isFrozen(captured));
assert.ok(Object.isFrozen(captured.rows));
assert.throws(
  () =>
    captureManuscriptBlockDiffView({
      rows: [block({ rowId: "before", blockId: "block-1", diffKind: "modified-before", changeId: "change-1" })],
    }),
  /pair/,
);
assert.throws(
  () =>
    captureManuscriptBlockDiffView({
      rows: [
        block({ rowId: "before", blockId: "block-1", diffKind: "modified-before", changeId: "change-1" }),
        block({ rowId: "after", blockId: "block-2", diffKind: "modified-after", changeId: "change-1" }),
      ],
    }),
  /pair/,
);
assert.throws(
  () =>
    captureManuscriptBlockDiffView({
      rows: [block({ rowId: "move", blockId: "block-1", diffKind: "moved", changeId: "move-1" })],
    }),
  /move labels/,
);

const markup = renderToStaticMarkup(createElement(ManuscriptChangeReviewer, { view: captured }));
for (const kind of ["added", "deleted", "modified-before", "modified-after", "moved", "unchanged"]) {
  assert.match(markup, new RegExp(`data-diff-kind="${kind}"`));
}
assert.match(markup, /第一章开头 → 第二章结尾/);
assert.match(markup, /行内词级差异尚未启用/);
assert.match(markup, /data-block-id="block-modified"/);
assert.match(markup, /海雾笼罩着白塔港。/);

installDom();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => root.render(createElement(ManuscriptChangeReviewer, { view: captured })));
const moved = container.querySelector('.novel-manuscript-diff-block[data-diff-kind="moved"]');
await act(async () => {
  moved.click();
  await Promise.resolve();
});
assert.equal(
  container.querySelector('.novel-manuscript-diff-block[data-diff-kind="moved"]').dataset.selected,
  "true",
);
await act(async () => root.unmount());
console.log("manuscript change reviewer smoke passed");

function createView() {
  return {
    rows: [
      block({ rowId: "context", blockId: "block-context", diffKind: "unchanged", text: "海雾笼罩着白塔港。" }),
      block({ rowId: "added", blockId: "block-added", diffKind: "added", changeId: "change-added", text: "远处传来失真的钟声。" }),
      block({ rowId: "deleted", blockId: "block-deleted", diffKind: "deleted", changeId: "change-deleted", text: "守塔人挥手示意。" }),
      block({ rowId: "before", blockId: "block-modified", diffKind: "modified-before", changeId: "change-modified", text: "林舟转身离开。" }),
      block({ rowId: "after", blockId: "block-modified", diffKind: "modified-after", changeId: "change-modified", text: "林舟走向灯塔深处。" }),
      block({ rowId: "moved", blockId: "block-moved", diffKind: "moved", changeId: "change-moved", text: "旧信纸在风中展开。", sourceLabel: "第一章开头", targetLabel: "第二章结尾" }),
    ],
  };
}

function block(overrides) {
  return {
    rowId: overrides.rowId,
    blockId: overrides.blockId,
    diffKind: overrides.diffKind,
    ...(overrides.changeId === undefined ? {} : { changeId: overrides.changeId }),
    text: overrides.text ?? "正文块",
    contextLabel: "第一章",
    ...(overrides.sourceLabel === undefined ? {} : { sourceLabel: overrides.sourceLabel }),
    ...(overrides.targetLabel === undefined ? {} : { targetLabel: overrides.targetLabel }),
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
