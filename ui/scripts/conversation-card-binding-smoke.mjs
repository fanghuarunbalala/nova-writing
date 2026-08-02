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
  ConversationCardProjectionStore,
  ConversationCardProjectorRegistry,
  InspectorStore,
  NovelApp,
} from "../dist/index.js";

installDom();
const logs = [];
const logger = createCollectingLogger(logs);
const conversationId = "conversation-card-binding";
const host = new DeterministicMockNovelHost({ logger });
host.registerConversation({ snapshot: createConversationSnapshot(conversationId) });
await host.appendOutput({
  id: "event-card-replay",
  conversationId,
  eventType: "novel.test.reference",
  schemaVersion: 1,
  timestamp: "2026-08-02T13:00:00.000Z",
  payload: { secret: "private-card-replay" },
});
const transport = new MockElectronApiTransport({ host, logger });
const api = new DefaultNovelApiClient({ transport, logger });
const shellStore = new ApplicationShellStore({
  conversation: { id: conversationId, label: "卡片对话" },
});
const inspectorStore = new InspectorStore();
const cardProjectors = new ConversationCardProjectorRegistry([
  {
    eventType: "novel.test.reference",
    projector: (event) => ({
      cardId: `card:${event.id}`,
      kind: "novel-reference",
      title: "结构化引用",
      summary: "打开右侧查看",
      status: "informational",
      inspectorTarget: {
        key: `reference:${event.id}`,
        kind: "novel-reference",
        title: "引用详情",
      },
    }),
  },
]);
assertProjectionStoreSemantics(cardProjectors, logger);
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
      conversationCardProjectors: cardProjectors,
      logger,
    }),
  );
});
await waitForReact(() => container.textContent.includes("结构化引用"));
assert.equal(
  logs.filter((entry) => entry.event === "mock_novel_host.subscription_opened").length,
  1,
);
assert.equal(JSON.stringify(logs).includes("private-card-replay"), false);

await act(async () => {
  await host.appendOutput({
    id: "event-card-live",
    conversationId,
    eventType: "novel.test.reference",
    schemaVersion: 1,
    timestamp: "2026-08-02T13:00:01.000Z",
    payload: { secret: "private-card-live" },
  });
  await waitFor(
    () => container.querySelectorAll(".novel-conversation-card").length === 2,
  );
});
assert.equal(JSON.stringify(logs).includes("private-card-live"), false);

await act(async () => container.querySelector(".novel-conversation-card button").click());
assert.equal(inspectorStore.getSnapshot().target.kind, "novel-reference");

await act(async () => root.unmount());
await transport.close();
await host.close();
console.log("conversation card binding smoke passed");

function assertProjectionStoreSemantics(projectors, projectionLogger) {
  const persisted = Object.freeze({
    id: "event-card-store",
    conversationId: "conversation-card-store",
    eventType: "novel.test.reference",
    schemaVersion: 1,
    timestamp: "2026-08-02T13:30:00.000Z",
    payload: Object.freeze({}),
    direction: "output",
    sequence: 1,
    recordedAt: "2026-08-02T13:30:00.100Z",
  });
  const store = new ConversationCardProjectionStore({
    conversationId: persisted.conversationId,
    projectors,
    logger: projectionLogger,
  });
  assert.equal(store.apply(persisted), "applied");
  assert.equal(store.apply(persisted), "duplicate");
  assert.equal(store.getCardSnapshot().cards.length, 1);

  const gapStore = new ConversationCardProjectionStore({
    conversationId: persisted.conversationId,
    projectors,
    logger: projectionLogger,
  });
  assert.throws(() => gapStore.apply({ ...persisted, sequence: 2 }), /sequence/i);
  assert.equal(gapStore.getCardSnapshot().cards.length, 0);

  let title = "first";
  const changingProjectors = new ConversationCardProjectorRegistry([
    {
      eventType: persisted.eventType,
      projector: () => ({
        cardId: "card-changing",
        kind: "novel-reference",
        title,
        status: "informational",
      }),
    },
  ]);
  const changingStore = new ConversationCardProjectionStore({
    conversationId: persisted.conversationId,
    projectors: changingProjectors,
    logger: projectionLogger,
  });
  changingStore.apply(persisted);
  title = "second";
  assert.throws(() => changingStore.apply(persisted), /projection changed/);
  assert.equal(changingStore.getCardSnapshot().cards[0].title, "first");
}

function createConversationSnapshot(id) {
  return Object.freeze({
    metadata: Object.freeze({
      id,
      workspaceId: "workspace-card",
      rootConversationId: id,
      status: "active",
      createdAt: "2026-08-02T13:00:00.000Z",
      updatedAt: "2026-08-02T13:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${id}`,
      conversationId: id,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-02T13:00:00.000Z",
    }),
  });
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

async function waitForReact(predicate) {
  await act(async () => waitFor(predicate));
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Card Binding");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() { return this; },
  };
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
