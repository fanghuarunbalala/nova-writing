import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  ConversationCardProjectorRegistry,
  ConversationTimeline,
  InspectorStore,
} from "../dist/index.js";

const secret = "private-proposal-payload";
const event = Object.freeze({
  id: "event-card-1",
  conversationId: "conversation-card",
  eventType: "novel.test.reference",
  schemaVersion: 1,
  timestamp: "2026-08-02T12:00:00.000Z",
  payload: Object.freeze({ secret }),
  direction: "output",
  sequence: 3,
  recordedAt: "2026-08-02T12:00:00.100Z",
});
const projectors = new ConversationCardProjectorRegistry([
  {
    eventType: event.eventType,
    projector: () => ({
      cardId: "card-reference-1",
      kind: "novel-reference",
      title: "人物设定已准备",
      summary: "查看林舟的人物摘要",
      status: "informational",
      inspectorTarget: {
        key: "character:character-1",
        kind: "character",
        title: "林舟",
        parameters: { characterId: "character-1" },
      },
      inspectorSize: "normal",
    }),
  },
]);
assert.throws(
  () =>
    new ConversationCardProjectorRegistry([
      { eventType: event.eventType, projector: () => undefined },
      { eventType: event.eventType, projector: () => undefined },
    ]),
  /unique/,
);
const card = projectors.project(event);
assert.ok(card);
assert.ok(Object.isFrozen(card));
assert.ok(Object.isFrozen(card.inspectorTarget));
assert.equal(JSON.stringify(card).includes(secret), false);
assert.equal(projectors.projectMany([event]).length, 1);
assert.throws(() => projectors.projectMany([event, event]), /Card id must be unique/);

installDom();
const inspectorStore = new InspectorStore();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(ConversationTimeline, {
      projection: createProjection(),
      cards: [card],
      onOpenCardInspector: (selected) =>
        inspectorStore.open(selected.inspectorTarget, {
          mode: selected.inspectorSize,
        }),
    }),
  );
});
assert.match(container.textContent, /人物设定已准备/);
assert.match(container.textContent, /查看林舟的人物摘要/);
assert.doesNotMatch(container.textContent, new RegExp(secret));
await act(async () => container.querySelector(".novel-conversation-card button").click());
assert.equal(inspectorStore.getSnapshot().target.key, "character:character-1");
assert.equal(inspectorStore.getSnapshot().mode, "normal");

assert.throws(
  () =>
    renderToStaticMarkup(
      createElement(ConversationTimeline, {
        projection: createProjection(),
        cards: [{ ...card, conversationId: "conversation-other" }],
      }),
    ),
  /another Conversation/,
);

await act(async () => root.unmount());
console.log("conversation card smoke passed");

function createProjection() {
  return Object.freeze({
    conversationId: "conversation-card",
    revision: 0,
    lastAppliedSequence: 3,
    events: Object.freeze([]),
    timeline: Object.freeze([]),
    userMessages: Object.freeze([]),
    assistantMessages: Object.freeze([]),
    approvals: Object.freeze([]),
    runs: Object.freeze([]),
    turns: Object.freeze([]),
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
