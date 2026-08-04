import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  ConversationRuntimeStatusView,
  useConversationRuntimeStatus,
} from "../dist/index.js";

installDom();
const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const reactRoot = createRoot(container);

const calls = [];
await act(async () => {
  reactRoot.render(
    createElement(ConversationRuntimeStatusView, {
      status: "not_configured",
      failureCode: "model_profile_unselected",
      onRetry: () => calls.push("retry"),
      onOpenSettings: () => calls.push("settings"),
    }),
  );
});
assert.equal(container.textContent.includes("未配置"), true);
assert.equal(container.textContent.includes("model_profile_unselected"), true);
await clickButton("重试");
await clickButton("打开设置");
assert.deepEqual(calls, ["retry", "settings"]);

await act(async () => {
  reactRoot.render(
    createElement(ConversationRuntimeStatusView, {
      status: "generating",
      onStop: () => calls.push("stop"),
    }),
  );
});
assert.equal(container.textContent.includes("生成中"), true);
await clickButton("停止");
assert.deepEqual(calls, ["retry", "settings", "stop"]);

await act(async () => {
  reactRoot.render(
    createElement(ConversationRuntimeStatusView, {
      status: "online",
    }),
  );
});
assert.equal(container.textContent.includes("在线"), true);
assert.equal(container.querySelector("button"), null);

function StatusProbe({ snapshot }) {
  const { status } = useConversationRuntimeStatus(snapshot);
  return createElement("div", { "data-status": status }, status);
}
await act(async () => {
  reactRoot.render(
    createElement(StatusProbe, {
      snapshot: createSnapshot({
        presence: { state: "online", observedAt: "" },
        runs: [{ current: "running" }],
        turns: [],
      }),
    }),
  );
});
assert.equal(
  container.querySelector("[data-status]").getAttribute("data-status"),
  "generating",
);

await act(async () => reactRoot.unmount());
console.log("Conversation Runtime status UI smoke passed");

async function clickButton(label) {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent.includes(label),
  );
  assert.ok(button, `missing button: ${label}`);
  await act(async () => button.click());
}

function createSnapshot({ presence, runs, turns }) {
  return {
    conversationId: "conversation-runtime-status",
    revision: 1,
    state: "active",
    projection: {
      conversationId: "conversation-runtime-status",
      revision: 1,
      lastAppliedSequence: 0,
      events: [],
      timeline: [],
      userMessages: [],
      assistantMessages: [],
      approvals: [],
      runs,
      turns,
      runtimePresence: presence,
    },
    cards: { cards: [] },
  };
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
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
