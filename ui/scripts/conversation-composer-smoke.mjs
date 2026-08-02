import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  StopInputEvent,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import { ConversationComposer } from "../dist/index.js";

installDom();
const calls = [];
let sequence = 0;
const enqueue = async (event) => {
  calls.push(event);
  sequence += 1;
  return {
    status: "accepted",
    conversationId: "conversation-composer",
    inputEventId: event.id,
    sequence,
    acceptedAt: "2026-08-02T10:00:00.000Z",
  };
};
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const root = createRoot(container);
await act(async () => {
  root.render(
    createElement(ConversationComposer, {
      conversationId: "conversation-composer",
      enabled: true,
      enqueue,
    }),
  );
});

const textarea = container.querySelector("textarea");
await setTextarea(textarea, "第一行");
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
});
assert.equal(calls.length, 0);
assert.equal(textarea.value, "第一行");

await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await waitFor(() => calls.length === 1);
});
assert.ok(calls[0] instanceof UserMessageInputEvent);
assert.equal(calls[0].getPayload().toObject().text, "第一行");
assert.equal(textarea.value, "");
assert.match(container.textContent, /消息已记录，等待 Agent 处理（#1）/);

await act(async () => {
  container.querySelector(".novel-stop-button").click();
  await waitFor(() => calls.length === 2);
});
assert.ok(calls[1] instanceof StopInputEvent);
assert.match(container.textContent, /停止请求已记录，等待 Runtime 处理（#2）/);

await act(async () => {
  root.render(
    createElement(ConversationComposer, {
      conversationId: "conversation-composer",
      enabled: true,
      enqueue: async () => {
        throw new Error("private-provider-error");
      },
    }),
  );
});
const failedTextarea = container.querySelector("textarea");
await setTextarea(failedTextarea, "失败消息");
await act(async () => {
  container.querySelector(".novel-send-button").click();
});
await waitForReact(() => container.textContent.includes("消息发送失败"));
assert.doesNotMatch(container.textContent, /private-provider-error/);

await act(async () => root.unmount());
console.log("conversation composer smoke passed");

async function setTextarea(textareaElement, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setter.call(textareaElement, value);
    textareaElement.dispatchEvent(new window.Event("input", { bubbles: true }));
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

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for Conversation Composer");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForReact(predicate) {
  await act(async () => waitFor(predicate));
}
