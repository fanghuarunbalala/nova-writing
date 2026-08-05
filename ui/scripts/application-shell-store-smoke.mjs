import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import { ApplicationShellStore, NovelApp } from "../dist/index.js";

const mutableWorkspace = { id: "workspace-1", label: "星海计划" };
const store = new ApplicationShellStore({ workspace: mutableWorkspace });
mutableWorkspace.label = "mutated";
assert.equal(store.getSnapshot().workspace.label, "星海计划");
assert.ok(Object.isFrozen(store.getSnapshot()));
assert.ok(Object.isFrozen(store.getSnapshot().workspace));

let notifications = 0;
store.subscribe(() => {
  notifications += 1;
});
store.setWorkspace({ id: "workspace-1", label: "星海计划" });
assert.equal(notifications, 0);
store.setMeta({ id: "meta-1", label: "主线大纲", kind: "outline" });
store.setConversation({ id: "conversation-1", label: "开篇讨论" });
store.setAgent({ id: "agent-1", label: "Novel Main" });
store.setSidebarMode("collapsed");
assert.equal(notifications, 4);
assert.equal(store.getSnapshot().revision, 4);

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
const { createRoot } = await import("react-dom/client");

const host = new DeterministicMockNovelHost();
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const platform = createPlatform();
const container = document.querySelector("#root");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(
      NovelApp,
      { api, platform, shellStore: store },
      createElement("div", { "data-conversation-tree": "stable" }, "Timeline"),
    ),
  );
});
const conversationNode = container.querySelector("[data-conversation-tree]");
assert.match(container.textContent, /星海计划/);
assert.equal(container.textContent.includes("主线大纲"), false);
assert.equal(
  container.querySelector(".novel-shell-body").dataset.sidebarMode,
  "collapsed",
);

await act(async () => {
  store.setWorkspace({ id: "workspace-2", label: "群星远征" });
  store.setSidebarMode("expanded");
});
assert.match(container.textContent, /群星远征/);
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);
assert.equal(
  container.querySelector(".novel-shell-body").dataset.sidebarMode,
  "expanded",
);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("application shell store smoke passed");

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
