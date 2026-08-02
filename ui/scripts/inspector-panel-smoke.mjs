import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { DefaultNovelApiClient } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import {
  InspectorRendererRegistry,
  InspectorStore,
  NovelApp,
} from "../dist/index.js";

function CharacterInspector({ target, content }) {
  return createElement(
    "article",
    { "data-character-inspector": target.key },
    `${target.title}:${content.status}`,
  );
}

assert.throws(
  () =>
    new InspectorRendererRegistry([
      { kind: "character", renderer: CharacterInspector },
      { kind: "character", renderer: CharacterInspector },
    ]),
  /unique/,
);
const registry = new InspectorRendererRegistry([
  { kind: "character", renderer: CharacterInspector },
]);
assert.equal(registry.has("character"), true);
assert.equal(registry.has("location"), false);

const store = new InspectorStore({
  target: { key: "character:1", kind: "character", title: "林舟" },
  mode: "normal",
});
store.markLoading("character:1");
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
      { api, platform: createPlatform(), inspectorStore: store, inspectorRenderers: registry },
      createElement("div", { "data-conversation-tree": "stable" }, "Timeline"),
    ),
  );
});
const conversationNode = container.querySelector("[data-conversation-tree]");
assert.match(container.textContent, /正在载入内容/);
assert.match(container.textContent, /林舟:loading/);

await act(async () => store.markError("character:1", "QUERY_FAILED", true));
assert.match(container.textContent, /内容载入失败（QUERY_FAILED）/);
assert.doesNotMatch(container.textContent, /private-query-error/);

await act(async () => {
  store.open(
    { key: "location:1", kind: "location", title: "白塔港" },
    { mode: "expanded" },
  );
});
assert.match(container.textContent, /当前内容尚未注册查看器/);
assert.equal(container.querySelector(".novel-shell-body").dataset.inspectorMode, "expanded");
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);

await act(async () => container.querySelector(".novel-inspector-actions button").click());
assert.match(container.textContent, /林舟:idle/);
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);

const actionButtons = [...container.querySelectorAll(".novel-inspector-actions button")];
await act(async () => actionButtons[1].click());
assert.equal(container.querySelector(".novel-shell-body").dataset.inspectorMode, "normal");
await act(async () => actionButtons[2].click());
assert.equal(container.querySelector(".novel-shell-body").dataset.inspectorMode, "closed");
assert.equal(container.querySelector("[data-conversation-tree]"), conversationNode);

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("inspector panel smoke passed");

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
