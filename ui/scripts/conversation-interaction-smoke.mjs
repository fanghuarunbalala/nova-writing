import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  createConversationInteractionCommands,
  useConversationInteraction,
} from "../dist/index.js";
import {
  AssistantMessageItem,
  ToolApprovalItem,
  UserMessageItem,
} from "../dist/index.js";

installDom();
const captured = [];
const enqueue = async (event) => {
  captured.push(event);
  return { status: "accepted", sequence: captured.length };
};
const commands = createConversationInteractionCommands({
  conversationId: "conversation-interaction",
  enqueue,
});

await commands.send("hello");
await commands.stop();
await commands.decideApproval({
  approvalRequestId: "approval-1",
  decision: "approved",
  argumentDigest: `sha256:${"a".repeat(64)}`,
});
const retryScenario = {
  kind: "assistant-message",
  assistantMessageId: "assistant-1",
  runId: "run-1",
  timestamp: "2026-08-04T13:00:00.000Z",
  status: "failed",
  content: [],
  userText: "retry me",
};
await commands.retryMessage(retryScenario);
await commands.editAndResend("edited");
await commands.clearContext();
await commands.compactContext();

assert.equal(captured[0].getEventType(), "user.message");
assert.deepEqual(captured[0].getPayload().toObject(), { text: "hello" });
assert.equal(captured[1].getEventType(), "system.stop");
assert.equal(captured[2].getEventType(), "command.tool.approval.decision");
assert.equal(captured[2].getPayload().toObject().decision, "approved");
assert.equal(captured[3].getEventType(), "user.message");
assert.deepEqual(captured[3].getPayload().toObject(), { text: "retry me" });
assert.deepEqual(captured[4].getPayload().toObject(), { text: "edited" });
assert.equal(captured[5].getEventType(), "context.clear");
assert.equal(captured[6].getEventType(), "context.compact");

const container = document.querySelector("#root");
const { createRoot } = await import("react-dom/client");
const reactRoot = createRoot(container);

function InteractionProbe({ result }) {
  const interaction = useConversationInteraction(result);
  return createElement(
    "div",
    { "data-status": interaction.runtime.status },
    JSON.stringify(interaction.scenarios.map((scenario) => scenario.kind)),
  );
}
await act(async () => {
  reactRoot.render(
    createElement(InteractionProbe, {
      result: {
        snapshot: createSnapshot(),
        enqueue,
        resume: async () => undefined,
      },
    }),
  );
});
assert.equal(
  container.querySelector("[data-status]").getAttribute("data-status"),
  "generating",
);
assert.equal(
  container.textContent.includes('"user-message"') &&
    container.textContent.includes('"assistant-message"') &&
    container.textContent.includes('"tool-approval"'),
  true,
);

const approvalCalls = [];
await act(async () => {
  reactRoot.render(
    createElement(ToolApprovalItem, {
      approval: approvalProjection(),
      onDecide: (decision) => approvalCalls.push(decision),
    }),
  );
});
await clickButton("允许");
await clickButton("拒绝");
assert.deepEqual(approvalCalls, ["approved", "rejected"]);

const retryCalls = [];
await act(async () => {
  reactRoot.render(
    createElement(AssistantMessageItem, {
      message: assistantProjection(),
      onRetry: () => retryCalls.push("retry"),
    }),
  );
});
assert.equal(container.textContent.includes("失败"), true);
await clickButton("重试");
assert.deepEqual(retryCalls, ["retry"]);

const resendCalls = [];
await act(async () => {
  reactRoot.render(
    createElement(UserMessageItem, {
      message: userProjection(),
      onResend: () => resendCalls.push("resend"),
    }),
  );
});
await clickButton("重发");
assert.deepEqual(resendCalls, ["resend"]);

await act(async () => reactRoot.unmount());
console.log("Conversation interaction smoke passed");

async function clickButton(label) {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent.includes(label),
  );
  assert.ok(button, `missing button: ${label}`);
  await act(async () => button.click());
}

function createSnapshot() {
  return {
    conversationId: "conversation-interaction",
    revision: 1,
    state: "active",
    projection: {
      conversationId: "conversation-interaction",
      revision: 1,
      lastAppliedSequence: 10,
      events: [],
      timeline: [userProjection(), assistantProjection(), approvalProjection()],
      userMessages: [userProjection()],
      assistantMessages: [assistantProjection()],
      approvals: [approvalProjection()],
      runs: [{ current: "running" }],
      turns: [],
      runtimePresence: { state: "online", observedAt: "2026-08-04T13:00:00.000Z" },
    },
    cards: { cards: [] },
  };
}

function userProjection() {
  return {
    kind: "user-message",
    eventId: "input-1",
    sequence: 1,
    timestamp: "2026-08-04T13:00:00.000Z",
    text: "retry me",
    runId: "run-1",
  };
}

function assistantProjection() {
  return {
    kind: "assistant-message",
    assistantMessageId: "assistant-1",
    runId: "run-1",
    turnId: "turn-1",
    startedSequence: 2,
    lastSequence: 5,
    timestamp: "2026-08-04T13:00:01.000Z",
    status: "failed",
    content: [],
    failureCode: "provider_error",
  };
}

function approvalProjection() {
  return {
    kind: "tool-approval",
    approvalRequestId: "approval-1",
    toolCallId: "tool-call-1",
    toolName: "TodoWrite",
    toolVersion: "1.0.0",
    argumentDigest: `sha256:${"a".repeat(64)}`,
    runId: "run-1",
    requestedSequence: 6,
    lastSequence: 6,
    title: "执行 TodoWrite",
    requestedAt: "2026-08-04T13:00:02.000Z",
    expiresAt: "2026-08-04T13:05:00.000Z",
    status: "pending",
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
