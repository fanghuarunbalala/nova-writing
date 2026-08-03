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
  NovelApp,
  StoryOutlineTree,
  StoryOutlineTreeController,
} from "../dist/index.js";

const conversationId = "conversation-outline-reference";
const controller = new StoryOutlineTreeController({
  view: createView(),
  expandedIds: ["root"],
  selectedId: "root",
});
const draftStore = new ComposerDraftStore();
const shellStore = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "星海计划" },
  novel: { id: "novel-1", label: "星海纪元" },
  conversation: { id: conversationId, label: "开篇讨论" },
});
const resolved = [];
const referenceForStoryUnit = (node, view) => {
  resolved.push({
    nodeId: node.id,
    sourceRevision: view.sourceRevision,
    readScope: view.readScope.kind,
  });
  return {
    key: `story-unit:${node.id}@${view.sourceRevision}`,
    kind: "story-unit",
    label: node.title,
    target: {
      key: `story-unit:${node.id}`,
      kind: "story-unit-detail",
      title: node.title,
      parameters: { storyUnitId: node.id },
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
      createElement(StoryOutlineTree, {
        controller,
        referenceForStoryUnit,
      }),
    ),
  );
});

let action = container.querySelector(".novel-reference-in-conversation");
assert.equal(action.dataset.referenceState, "ready");
assert.deepEqual(resolved.at(-1), {
  nodeId: "root",
  sourceRevision: "revision-ui",
  readScope: "draft",
});
await act(async () => action.click());
assert.deepEqual(
  draftStore.getSnapshot(conversationId).references.map((reference) => reference.key),
  ["story-unit:root@revision-ui"],
);

const rootRow = container.querySelector('[data-story-unit-id="root"]');
await act(async () => {
  rootRow.focus();
  rootRow.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await Promise.resolve();
});
assert.equal(controller.getSnapshot().selectedId, "opening");
action = container.querySelector(".novel-reference-in-conversation");
assert.equal(action.dataset.referenceState, "ready");
assert.deepEqual(resolved.at(-1), {
  nodeId: "opening",
  sourceRevision: "revision-ui",
  readScope: "draft",
});
await act(async () => action.click());
assert.deepEqual(
  draftStore.getSnapshot(conversationId).references.map((reference) => reference.key),
  ["story-unit:root@revision-ui", "story-unit:opening@revision-ui"],
);

const openingRow = container.querySelector('[data-story-unit-id="opening"]');
await act(async () => {
  openingRow.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  await Promise.resolve();
});
assert.equal(controller.getSnapshot().selectedId, "root");
assert.equal(
  container.querySelector(".novel-reference-in-conversation").dataset.referenceState,
  "referenced",
);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("story outline reference smoke passed");

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
        childIds: ["opening"],
        planningStatus: "outlined",
        realizationStatus: "in-progress",
        progress: { completedLeafCount: 0, totalLeafCount: 1 },
      }),
      opening: node({
        id: "opening",
        parentId: "root",
        title: "异常梦境",
        planningStatus: "ready",
        realizationStatus: "pending",
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
    progress: overrides.progress,
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
