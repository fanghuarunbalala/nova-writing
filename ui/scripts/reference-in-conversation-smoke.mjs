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
  InspectorRendererRegistry,
  InspectorStore,
  NovelApp,
  ReferenceInConversationButton,
} from "../dist/index.js";

const conversationId = "conversation-reference-action";
const reference = createReference();
const draftStore = new ComposerDraftStore();
const shellStore = new ApplicationShellStore({
  workspace: { id: "workspace-1", label: "星海计划" },
  novel: { id: "novel-1", label: "星海纪元" },
  conversation: { id: conversationId, label: "开篇讨论" },
});
const inspectorStore = new InspectorStore({
  target: reference.target,
  mode: "normal",
});
const rendererRegistry = new InspectorRendererRegistry([
  {
    kind: "story-unit-detail",
    renderer: function StoryUnitInspector() {
      return createElement(ReferenceInConversationButton, { reference });
    },
  },
]);

installDom();
const host = new DeterministicMockNovelHost();
host.registerConversation({
  snapshot: createConversationSnapshot(conversationId),
  runtimePresence: {
    state: "online",
    observedAt: "2026-08-03T00:00:00.000Z",
  },
});
const transport = new MockElectronApiTransport({ host });
const api = new DefaultNovelApiClient({ transport });
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(NovelApp, {
      api,
      platform: createPlatform(),
      shellStore,
      inspectorStore,
      inspectorRenderers: rendererRegistry,
      composerDraftStore: draftStore,
    }),
  );
});
await waitForReact(
  () => container.querySelector(".novel-reference-in-conversation") !== null,
);

let action = container.querySelector(".novel-reference-in-conversation");
assert.equal(action.dataset.referenceState, "ready");
assert.equal(draftStore.getSnapshot(conversationId).references.length, 0);

await act(async () => action.click());
assert.equal(draftStore.getSnapshot(conversationId).references.length, 1);
action = container.querySelector(".novel-reference-in-conversation");
assert.equal(action.dataset.referenceState, "referenced");
assert.equal(action.disabled, true);
assert.match(container.textContent, /灯塔调查/);

await act(async () => inspectorStore.close());
assert.equal(container.querySelector(".novel-inspector-panel"), null);
assert.match(container.textContent, /灯塔调查/);
await act(async () => container.querySelector(".novel-composer-reference-open").click());
assert.equal(inspectorStore.getSnapshot().target.key, reference.target.key);
assert.equal(inspectorStore.getSnapshot().mode, "normal");

await act(async () => container.querySelector(".novel-composer-reference-remove").click());
assert.equal(draftStore.getSnapshot(conversationId).references.length, 0);
assert.equal(
  container.querySelector(".novel-reference-in-conversation").dataset.referenceState,
  "ready",
);

await act(async () => {
  draftStore.addReference(conversationId, {
    ...reference,
    label: "同一身份的冲突版本",
  });
});
action = container.querySelector(".novel-reference-in-conversation");
assert.equal(action.dataset.referenceState, "conflict");
assert.equal(action.disabled, true);

await act(async () => shellStore.setConversation(undefined));
action = container.querySelector(".novel-reference-in-conversation");
assert.equal(action.dataset.referenceState, "unavailable");
assert.equal(action.disabled, true);
assert.match(action.textContent, /没有当前对话/);

const conversation = await api.conversations.open(conversationId);
const page = await conversation.events.list({ anchor: { from: "start" } });
assert.equal(page.events.length, 0);
await conversation.close();
await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("reference in conversation smoke passed");

function createReference() {
  return {
    key: "story-unit:story-unit-1@revision-7",
    kind: "story-unit",
    label: "灯塔调查",
    target: {
      key: "story-unit:story-unit-1",
      kind: "story-unit-detail",
      title: "灯塔调查",
      parameters: { storyUnitId: "story-unit-1" },
    },
  };
}

function createConversationSnapshot(id) {
  return Object.freeze({
    metadata: Object.freeze({
      id,
      workspaceId: "workspace-1",
      rootConversationId: id,
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${id}`,
      conversationId: id,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
    }),
  });
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

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for reference action");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForReact(predicate) {
  await act(async () => waitFor(predicate));
}
