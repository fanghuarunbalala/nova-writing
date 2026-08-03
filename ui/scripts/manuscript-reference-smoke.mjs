import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import {
  ApplicationShellStore,
  ComposerDraftStore,
  ManuscriptChangeReviewer,
  NovelApp,
} from "../dist/index.js";

const conversationId = "conversation-manuscript-reference";
const draftStore = new ComposerDraftStore();
const shellStore = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "星海计划" },
  novel: { id: "novel-1", label: "星海纪元" },
  conversation: { id: conversationId, label: "正文审阅" },
});
const resolved = [];
const referenceForBlock = (row, view) => {
  resolved.push({
    rowId: row.rowId,
    blockId: row.blockId,
    diffKind: row.diffKind,
    rowCount: view.rows.length,
  });
  return {
    key: `manuscript-block:${row.blockId}:${row.diffKind}`,
    kind: "manuscript-block",
    label: `${row.contextLabel ?? "正文块"} · ${row.diffKind}`,
    target: {
      key: `manuscript-block:${row.rowId}`,
      kind: "manuscript-block-review",
      title: row.contextLabel ?? "正文块",
      parameters: { rowId: row.rowId, blockId: row.blockId },
    },
  };
};

installDom();
const host = new DeterministicMockNovelHost();
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(
      NovelApp,
      {
        api,
        platform: createPlatform(),
        shellStore,
        composerDraftStore: draftStore,
      },
      createElement(ManuscriptChangeReviewer, {
        view: createView(),
        referenceForBlock,
      }),
    ),
  );
});
assert.equal(container.querySelector(".novel-reference-in-conversation"), null);

await selectAndReference("modified-before");
assert.deepEqual(resolved.at(-1), {
  rowId: "before",
  blockId: "block-modified",
  diffKind: "modified-before",
  rowCount: 6,
});
await selectAndReference("modified-after");
assert.deepEqual(resolved.at(-1), {
  rowId: "after",
  blockId: "block-modified",
  diffKind: "modified-after",
  rowCount: 6,
});
await selectAndReference("moved");

assert.deepEqual(
  draftStore.getSnapshot(conversationId).references.map((reference) => reference.key),
  [
    "manuscript-block:block-modified:modified-before",
    "manuscript-block:block-modified:modified-after",
    "manuscript-block:block-moved:moved",
  ],
);
assert.equal(
  draftStore.getSnapshot(conversationId).references.at(-1).label,
  "第一章 · moved",
);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("manuscript reference smoke passed");

async function selectAndReference(diffKind) {
  const row = container.querySelector(
    `.novel-manuscript-diff-block[data-diff-kind="${diffKind}"]`,
  );
  await act(async () => row.click());
  const action = container.querySelector(".novel-reference-in-conversation");
  assert.equal(action.dataset.referenceState, "ready");
  await act(async () => action.click());
  assert.equal(
    container.querySelector(".novel-reference-in-conversation").dataset.referenceState,
    "referenced",
  );
}

function createView() {
  return {
    rows: [
      block({ rowId: "context", blockId: "block-context", diffKind: "unchanged" }),
      block({ rowId: "added", blockId: "block-added", diffKind: "added", changeId: "change-added" }),
      block({ rowId: "deleted", blockId: "block-deleted", diffKind: "deleted", changeId: "change-deleted" }),
      block({ rowId: "before", blockId: "block-modified", diffKind: "modified-before", changeId: "change-modified" }),
      block({ rowId: "after", blockId: "block-modified", diffKind: "modified-after", changeId: "change-modified" }),
      block({
        rowId: "moved",
        blockId: "block-moved",
        diffKind: "moved",
        changeId: "change-moved",
        sourceLabel: "第一章开头",
        targetLabel: "第二章结尾",
      }),
    ],
  };
}

function block(overrides) {
  return {
    rowId: overrides.rowId,
    blockId: overrides.blockId,
    diffKind: overrides.diffKind,
    ...(overrides.changeId === undefined ? {} : { changeId: overrides.changeId }),
    text: `正文 ${overrides.rowId}`,
    contextLabel: "第一章",
    ...(overrides.sourceLabel === undefined ? {} : { sourceLabel: overrides.sourceLabel }),
    ...(overrides.targetLabel === undefined ? {} : { targetLabel: overrides.targetLabel }),
  };
}

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { pretendToBeVisual: true },
  );
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

function createPlatform() {
  return Object.freeze({
    capabilities: Object.freeze({
      fileSelection: false,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
    }),
    files: Object.freeze({ selectFiles: async () => Object.freeze([]) }),
    clipboard: Object.freeze({
      readText: async () => "",
      writeText: async () => undefined,
    }),
    notifications: Object.freeze({ show: async () => undefined }),
  });
}
