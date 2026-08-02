import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import { InspectorStore, NovelApp } from "../dist/index.js";

const mutableTarget = {
  key: "character:character-1",
  kind: "character",
  title: "林舟",
  parameters: { novelId: "novel-1", characterId: "character-1" },
};
const store = new InspectorStore({ target: mutableTarget, mode: "normal" });
assert.throws(
  () => new InspectorStore({ target: mutableTarget, mode: "closed" }),
  /Visible Inspector size/,
);
mutableTarget.title = "mutated";
mutableTarget.parameters.characterId = "mutated";
assert.equal(store.getSnapshot().target.title, "林舟");
assert.equal(store.getSnapshot().target.parameters.characterId, "character-1");
assert.ok(Object.isFrozen(store.getSnapshot()));
assert.ok(Object.isFrozen(store.getSnapshot().navigation));
assert.ok(Object.isFrozen(store.getSnapshot().target.parameters));

let notifications = 0;
store.subscribe(() => {
  notifications += 1;
});
assert.equal(store.markLoading("stale-target"), false);
assert.equal(notifications, 0);
assert.equal(store.markLoading("character:character-1"), true);
store.setActiveTab("profile");
store.setSelectedNodeKey("field:motivation");
store.open({ ...mutableTarget, title: "林舟 · 人物卡" });
assert.equal(store.getSnapshot().navigation.length, 1);
assert.equal(store.getSnapshot().target.title, "林舟 · 人物卡");
store.open(
  {
    key: "location:location-1",
    kind: "location",
    title: "白塔港",
    parameters: { novelId: "novel-1", locationId: "location-1" },
  },
  { mode: "expanded" },
);
assert.equal(store.getSnapshot().canGoBack, true);
assert.equal(store.getSnapshot().navigation.length, 2);
assert.equal(store.getSnapshot().content.status, "idle");
assert.equal(store.markLoaded("character:character-1"), false);
assert.equal(store.markError("location:location-1", "INSPECTOR_QUERY_FAILED", true), true);
assert.deepEqual(store.getSnapshot().content, {
  status: "error",
  code: "INSPECTOR_QUERY_FAILED",
  retryable: true,
});
store.back();
assert.equal(store.getSnapshot().target.key, "character:character-1");
assert.equal(store.getSnapshot().mode, "expanded");
assert.equal(store.getSnapshot().content.status, "idle");

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
        inspectorStore: store,
        shell: { inspector: createElement("div", { "data-inspector-content": true }, "Inspector") },
      },
      createElement("div", { "data-conversation-tree": "stable" }, "Timeline"),
    ),
  );
});
const conversationNode = container.querySelector("[data-conversation-tree]");
assert.equal(container.querySelector(".novel-shell-body").dataset.inspectorMode, "expanded");
assert.equal(container.querySelector(".novel-inspector-host").getAttribute("aria-hidden"), "false");

await act(async () => store.setMode("normal"));
assert.equal(container.querySelector(".novel-shell-body").dataset.inspectorMode, "normal");
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);

await act(async () => store.close());
assert.equal(container.querySelector(".novel-shell-body").dataset.inspectorMode, "closed");
assert.equal(container.querySelector(".novel-inspector-host").getAttribute("aria-hidden"), "true");
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);
assert.equal(store.getSnapshot().navigation.length, 0);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("inspector store smoke passed");

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
