import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { ApplicationShellStore, NovelApp } from "../dist/index.js";
import { DefaultNovelApiClient, UserMessageInputEvent } from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockTransportFaultController,
} from "../../core/dist/testing/index.js";

installDom();
const host = new DeterministicMockNovelHost();
const conversationId = "conversation-connection-status";
host.registerConversation({ snapshot: createConversationSnapshot(conversationId) });
const faults = new MockTransportFaultController();
const transport = new MockElectronApiTransport({ host, faultController: faults });
const api = new DefaultNovelApiClient({ transport });
const external = await api.conversations.open(conversationId);
await external.input.enqueue(
  new UserMessageInputEvent({ id: "evt-before-disconnect", text: "断线前内容" }),
);
const shellStore = new ApplicationShellStore({
  conversation: { id: conversationId, label: "连接测试" },
});
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(createElement(NovelApp, { api, platform: createPlatform(), shellStore }));
});
await waitForReact(() => container.querySelector(".novel-conversation-view")?.dataset.controllerState === "live");
assert.match(container.textContent, /断线前内容/);

const scrollParent = container.querySelector(".novel-conversation-content");
Object.defineProperties(scrollParent, {
  scrollHeight: { configurable: true, value: 1000 },
  clientHeight: { configurable: true, value: 400 },
  scrollTop: { configurable: true, writable: true, value: 100 },
});
await act(async () => scrollParent.dispatchEvent(new window.Event("scroll")));
await act(async () => {
  await external.input.enqueue(
    new UserMessageInputEvent({ id: "evt-new-while-reading", text: "阅读时的新消息" }),
  );
  await waitFor(() => container.textContent.includes("阅读时的新消息"));
});
assert.match(container.textContent, /阅读时的新消息/);
assert.match(container.textContent, /有新消息，回到最新/);
await act(async () => container.querySelector(".novel-follow-latest").click());
assert.doesNotMatch(container.textContent, /有新消息，回到最新/);

await act(async () => {
  faults.disconnect();
  await waitFor(() => container.textContent.includes("连接已断开"));
});
assert.match(container.textContent, /断线前内容/);
assert.match(container.textContent, /API_TRANSPORT_DISCONNECTED/);
await host.appendEvent({
  direction: "input",
  snapshot: new UserMessageInputEvent({
    id: "evt-offline",
    conversationId,
    text: "离线期间持久化的消息",
  }).getSnapshot(),
});
faults.reconnect();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.match(container.textContent, /连接已断开/);
assert.doesNotMatch(container.textContent, /离线期间持久化的消息/);

await act(async () => {
  container.querySelector(".novel-connection-action").click();
  await waitFor(() => container.querySelector(".novel-conversation-view")?.dataset.controllerState === "live");
});
assert.match(container.textContent, /离线期间持久化的消息/);
assert.doesNotMatch(container.textContent, /连接已断开/);

await act(async () => root.unmount());
await external.close();
await transport.close();
await host.close();
console.log("conversation connection status smoke passed");

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

function createConversationSnapshot(id) {
  return Object.freeze({
    metadata: Object.freeze({ id, workspaceId: "workspace-ui", rootConversationId: id, status: "active", createdAt: "2026-08-02T09:00:00.000Z", updatedAt: "2026-08-02T09:00:00.000Z", lastJournalSequence: 0 }),
    activeAgentBinding: Object.freeze({ id: `binding-${id}`, conversationId: id, revision: 1, agentType: "novel.main", definitionVersion: "1", status: "active", createdAt: "2026-08-02T09:00:00.000Z" }),
  });
}

async function waitForReact(predicate) { await act(async () => waitFor(predicate)); }
async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for connection UI");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createPlatform() {
  return Object.freeze({
    capabilities: Object.freeze({ fileSelection: false, clipboardRead: false, clipboardWrite: false, notifications: false }),
    files: Object.freeze({ selectFiles: async () => Object.freeze([]) }),
    clipboard: Object.freeze({ readText: async () => "", writeText: async () => undefined }),
    notifications: Object.freeze({ show: async () => undefined }),
  });
}
