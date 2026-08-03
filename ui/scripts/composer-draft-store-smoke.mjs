import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import {
  ApplicationShellStore,
  ComposerDraftStore,
  ConversationComposer,
  InspectorStore,
  NovelApp,
} from "../dist/index.js";

const mutableReference = createReference();
const store = new ComposerDraftStore([
  {
    conversationId: "conversation-1",
    text: "保留的草稿",
    references: [mutableReference],
  },
]);
mutableReference.label = "被修改的标签";
mutableReference.target.parameters.storyUnitId = "mutated";

const first = store.getSnapshot("conversation-1");
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.references));
assert.ok(Object.isFrozen(first.references[0]));
assert.ok(Object.isFrozen(first.references[0].target));
assert.ok(Object.isFrozen(first.references[0].target.parameters));
assert.equal(first.references[0].label, "灯塔调查");
assert.equal(first.references[0].target.parameters.storyUnitId, "story-unit-1");
assert.equal(store.getSnapshot("conversation-2").text, "");

let notifications = 0;
store.subscribe(() => {
  notifications += 1;
});
store.addReference("conversation-1", createReference());
assert.equal(notifications, 0);
assert.throws(
  () =>
    store.addReference("conversation-1", {
      ...createReference(),
      label: "相同 Key 的冲突引用",
    }),
  /already bound/,
);
store.setText("conversation-2", "另一段草稿");
assert.equal(notifications, 1);
assert.equal(store.getSnapshot("conversation-1").text, "保留的草稿");

installDom();
const calls = [];
let openedTarget;
const enqueue = async (event) => {
  calls.push(event);
  return {
    status: "accepted",
    conversationId: "conversation-1",
    inputEventId: event.id,
    sequence: 1,
    acceptedAt: "2026-08-03T00:00:00.000Z",
  };
};
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(ConversationComposer, {
      conversationId: "conversation-1",
      draftStore: store,
      enabled: true,
      enqueue,
      onOpenReference: (reference) => {
        openedTarget = reference.target;
      },
    }),
  );
});

assert.equal(container.querySelector("textarea").value, "保留的草稿");
assert.match(container.textContent, /灯塔调查/);
assert.match(container.textContent, /发送将在统一 InputEvent 引用协议接入后启用/);
assert.equal(container.querySelector(".novel-send-button").disabled, true);

await act(async () => container.querySelector(".novel-composer-reference-open").click());
assert.equal(openedTarget.key, "outline:story-unit-1");

await act(async () => container.querySelector(".novel-composer-reference-remove").click());
assert.equal(store.getSnapshot("conversation-1").references.length, 0);
assert.equal(container.querySelector(".novel-send-button").disabled, false);

await act(async () => {
  container.querySelector(".novel-send-button").click();
  await waitFor(() => calls.length === 1);
});
assert.ok(calls[0] instanceof UserMessageInputEvent);
assert.equal(calls[0].getPayload().toObject().text, "保留的草稿");
assert.equal(store.getSnapshot("conversation-1").text, "");
assert.equal(store.getSnapshot("conversation-2").text, "另一段草稿");

await act(async () => {
  store.setText("conversation-1", "重新打开仍存在");
  root.render(
    createElement(ConversationComposer, {
      conversationId: "conversation-2",
      draftStore: store,
      enabled: true,
      enqueue,
    }),
  );
});
assert.equal(container.querySelector("textarea").value, "另一段草稿");
await act(async () => {
  root.render(
    createElement(ConversationComposer, {
      conversationId: "conversation-1",
      draftStore: store,
      enabled: true,
      enqueue,
    }),
  );
});
assert.equal(container.querySelector("textarea").value, "重新打开仍存在");

await act(async () => root.unmount());
await assertNovelAppOpensReferencedInspector(container);
console.log("composer draft store smoke passed");

function createReference() {
  return {
    key: "story-unit:story-unit-1@revision-7",
    kind: "story-unit",
    label: "灯塔调查",
    target: {
      key: "outline:story-unit-1",
      kind: "outline",
      title: "灯塔调查",
      parameters: { storyUnitId: "story-unit-1" },
    },
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

async function assertNovelAppOpensReferencedInspector(container) {
  const conversationId = "conversation-app-reference";
  const appDraftStore = new ComposerDraftStore([
    {
      conversationId,
      text: "请修改这一段",
      references: [createReference()],
    },
  ]);
  const shellStore = new ApplicationShellStore({
    workspace: { id: "workspace-1", label: "星海计划" },
    novel: { id: "novel-1", label: "星海纪元" },
    conversation: { id: conversationId, label: "开篇讨论" },
  });
  const inspectorStore = new InspectorStore();
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
  const appRoot = (await import("react-dom/client")).createRoot(container);
  await act(async () => {
    appRoot.render(
      createElement(NovelApp, {
        api,
        platform: createPlatform(),
        shellStore,
        inspectorStore,
        composerDraftStore: appDraftStore,
      }),
    );
  });
  await waitForReact(
    () => container.querySelector(".novel-composer-reference-open") !== null,
  );
  await act(async () => container.querySelector(".novel-composer-reference-open").click());
  assert.equal(inspectorStore.getSnapshot().target.key, "outline:story-unit-1");
  assert.equal(inspectorStore.getSnapshot().mode, "normal");
  await act(async () => appRoot.unmount());
  await transport.close();
  await host.close();
}

function createConversationSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-1",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
    }),
  });
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
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Composer draft");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForReact(predicate) {
  await act(async () => waitFor(predicate));
}
