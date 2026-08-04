import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  ConversationCard,
  createDefaultNovelCardProjectorRegistry,
} from "../dist/index.js";

installDom();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
const registry = createDefaultNovelCardProjectorRegistry();

const card = registry.project(commitEvent());
assert.ok(card !== undefined);
assert.equal(card.kind, "novel-reference");
assert.equal(card.status, "completed");
assert.equal(card.title, "小说已提交");
assert.match(card.summary, /3 个操作/);
assert.equal(card.inspectorTarget.kind, "story-outline");
assert.equal(card.inspectorTarget.key, "story-outline:canonical");
assert.equal(card.sourceEventId, "event_commit_1");

const opened = [];
await act(async () => {
  root.render(createElement(ConversationCard, {
    card,
    onOpenInspector: (descriptor) => opened.push(descriptor),
  }));
});
const openButton = [...container.querySelectorAll("button")].find(
  (candidate) => candidate.textContent.includes("在右侧查看"),
);
assert.ok(openButton !== undefined);
await act(async () => openButton.click());
assert.equal(opened.length, 1);
assert.equal(opened[0].cardId, card.cardId);

assert.equal(registry.project(unregisteredEvent()), undefined);
assert.equal(registry.project(invalidCommitEvent()), undefined);

await act(async () => root.unmount());
console.log("novel commit card smoke passed");

function commitEvent() {
  return {
    id: "event_commit_1",
    conversationId: "conversation_1",
    direction: "output",
    eventType: "novel.commit.completed",
    schemaVersion: 1,
    timestamp: "2026-08-04T00:00:00.000Z",
    sequence: 7,
    payload: {
      lifecycleVersion: 1,
      novelId: "novel_1",
      draftSessionId: "draft_1",
      commitId: "commit_1",
      baseRevision: "revision_1",
      resultRevision: "revision_2",
      operationCount: 3,
    },
  };
}

function unregisteredEvent() {
  return {
    ...commitEvent(),
    id: "event_other_1",
    eventType: "novel.draft.started",
    sequence: 8,
  };
}

function invalidCommitEvent() {
  return {
    ...commitEvent(),
    id: "event_commit_invalid",
    sequence: 9,
    payload: { ...commitEvent().payload, operationCount: "three" },
  };
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
