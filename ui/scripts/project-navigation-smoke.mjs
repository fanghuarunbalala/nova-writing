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
  InspectorStore,
  NovelApp,
  ProjectNavigationController,
} from "../dist/index.js";

const directShell = new ApplicationShellStore();
const directInspector = new InspectorStore();
const directController = new ProjectNavigationController({
  shellStore: directShell,
  inspectorStore: directInspector,
});
assert.deepEqual(directController.navigate("new-conversation"), {
  status: "unsupported",
  item: "new-conversation",
});
directController.navigate("outline");
assert.equal(directInspector.getSnapshot().content.status, "unavailable");
assert.equal(directInspector.getSnapshot().content.code, "NOVEL_NOT_SELECTED");
directController.navigate("schedule");
assert.equal(
  directInspector.getSnapshot().content.code,
  "SCHEDULE_PROTOCOL_UNRESOLVED",
);

installDom();
const shellStore = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "群星计划" },
  novel: { id: "novel-1", label: "星海纪元" },
});
const inspectorStore = new InspectorStore();
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
      { api, platform: createPlatform(), shellStore, inspectorStore },
      createElement("div", { "data-conversation-tree": "stable" }, "Timeline"),
    ),
  );
});
const conversationNode = container.querySelector("[data-conversation-tree]");

await clickSidebar("大纲");
assert.equal(inspectorStore.getSnapshot().target.kind, "story-outline");
assert.equal(inspectorStore.getSnapshot().mode, "expanded");
assert.equal(inspectorStore.getSnapshot().navigation.length, 1);
assert.equal(shellStore.getSnapshot().meta.label, "大纲");
assert.match(container.textContent, /大纲/);
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);

await clickSidebar("人物");
assert.equal(inspectorStore.getSnapshot().target.kind, "character-index");
assert.equal(inspectorStore.getSnapshot().mode, "normal");
assert.equal(inspectorStore.getSnapshot().navigation.length, 1);
assert.equal(shellStore.getSnapshot().meta.label, "人物");
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);

const beforeNewConversation = inspectorStore.getSnapshot();
await clickSidebar("新对话");
assert.equal(inspectorStore.getSnapshot(), beforeNewConversation);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("project navigation smoke passed");

async function clickSidebar(label) {
  const button = [...container.querySelectorAll(".novel-sidebar-button")].find(
    (candidate) => candidate.textContent.includes(label),
  );
  assert.ok(button);
  await act(async () => button.click());
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
