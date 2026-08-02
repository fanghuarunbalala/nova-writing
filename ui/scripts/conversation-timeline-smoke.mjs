import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  AgentAssistantMessageCompletedOutputEvent,
  AgentAssistantMessageStartedOutputEvent,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import {
  DeterministicMockClock,
  DeterministicMockNovelHost,
  MockElectronApiTransport,
} from "../../core/dist/testing/index.js";
import {
  ApplicationShellStore,
  ConversationTimeline,
  NovelApp,
} from "../dist/index.js";

assertPresentationalTimeline();
await assertConnectedTimeline();
console.log("conversation timeline smoke passed");

function assertPresentationalTimeline() {
  const secretPayload = "payload-must-not-render";
  const projection = Object.freeze({
    conversationId: "conversation-presentational",
    revision: 4,
    lastAppliedSequence: 4,
    events: Object.freeze([
      Object.freeze({
        eventId: "evt-unknown",
        sequence: 4,
        direction: "output",
        eventType: "novel.unknown.safe",
        timestamp: "2026-08-02T07:00:04.000Z",
        recordedAt: "2026-08-02T07:00:04.000Z",
      }),
    ]),
    timeline: Object.freeze([
      Object.freeze({
        kind: "user-message",
        eventId: "evt-user",
        sequence: 1,
        timestamp: "2026-08-02T07:00:01.000Z",
        text: "请完善开篇",
      }),
      Object.freeze({
        kind: "assistant-message",
        assistantMessageId: "assistant-1",
        runId: "run-1",
        turnId: "turn-1",
        startedSequence: 2,
        lastSequence: 3,
        timestamp: "2026-08-02T07:00:02.000Z",
        status: "completed",
        content: Object.freeze([
          Object.freeze({ type: "text", text: "可以从主角的异常梦境开始。" }),
          Object.freeze({ type: "thinking", thinking: "节奏与悬念", redacted: true }),
        ]),
        completionReason: "stop",
        hasToolCalls: false,
      }),
      Object.freeze({
        kind: "tool-approval",
        approvalRequestId: "approval-1",
        toolCallId: "tool-call-1",
        toolName: "write_file",
        toolVersion: "1",
        argumentDigest: `sha256:${"0".repeat(64)}`,
        runId: "run-1",
        requestedSequence: 4,
        lastSequence: 4,
        title: "写入正文草稿",
        description: "确认后写入当前草稿",
        requestedAt: "2026-08-02T07:00:04.000Z",
        expiresAt: "2026-08-02T07:10:04.000Z",
        status: "pending",
      }),
    ]),
    userMessages: Object.freeze([]),
    assistantMessages: Object.freeze([]),
    approvals: Object.freeze([]),
    runs: Object.freeze([]),
    turns: Object.freeze([]),
  });
  const normal = renderToStaticMarkup(createElement(ConversationTimeline, { projection }));
  assert.match(normal, /请完善开篇/);
  assert.match(normal, /可以从主角的异常梦境开始/);
  assert.match(normal, /思考摘要/);
  assert.match(normal, /写入正文草稿/);
  assert.doesNotMatch(normal, /novel\.unknown\.safe/);
  assert.doesNotMatch(normal, new RegExp(secretPayload));

  const diagnostics = renderToStaticMarkup(
    createElement(ConversationTimeline, { projection, diagnostics: true }),
  );
  assert.match(diagnostics, /novel\.unknown\.safe/);
  assert.doesNotMatch(diagnostics, new RegExp(secretPayload));
}

async function assertConnectedTimeline() {
  installDom();
  const logs = [];
  const logger = createCollectingLogger(logs);
  const host = new DeterministicMockNovelHost({
    clock: new DeterministicMockClock({ start: "2026-08-02T08:00:00.000Z" }),
    logger,
  });
  const conversationId = "conversation-connected-timeline";
  host.registerConversation({ snapshot: createConversationSnapshot(conversationId) });
  const transport = new MockElectronApiTransport({ host, logger });
  const api = new DefaultNovelApiClient({ transport, logger });
  const external = await api.conversations.open(conversationId);
  const secretText = "private-connected-timeline-text";
  await external.input.enqueue(
    new UserMessageInputEvent({ id: "evt-ui-history", text: secretText }),
  );
  await host.appendOutput(
    new AgentAssistantMessageStartedOutputEvent({
      id: "evt-assistant-start",
      conversationId,
      runId: "run-ui",
      turnId: "turn-ui",
      assistantMessageId: "assistant-ui",
    }).getSnapshot(),
  );
  await host.appendOutput(
    new AgentAssistantMessageCompletedOutputEvent({
      id: "evt-assistant-complete",
      conversationId,
      runId: "run-ui",
      turnId: "turn-ui",
      assistantMessageId: "assistant-ui",
      content: [{ type: "text", text: "这是回放后的回答。" }],
      completionReason: "stop",
      hasToolCalls: false,
    }).getSnapshot(),
  );
  const shellStore = new ApplicationShellStore({
    conversation: { id: conversationId, label: "当前对话" },
  });
  const container = document.querySelector("#root");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(NovelApp, { api, platform: createPlatform(), shellStore, logger }));
  });
  await waitForReact(() => container.textContent.includes("这是回放后的回答。"));
  assert.match(container.textContent, new RegExp(secretText));
  assert.equal(container.querySelector(".novel-conversation-view").dataset.controllerState, "live");
  assert.equal(
    logs.filter((entry) => entry.event === "mock_novel_host.subscription_opened").length,
    1,
  );

  await act(async () => {
    await external.input.enqueue(
      new UserMessageInputEvent({ id: "evt-ui-live", text: "这是实时追加。" }),
    );
    await waitFor(() => container.textContent.includes("这是实时追加。"));
  });
  assert.equal(JSON.stringify(logs).includes(secretText), false);
  await act(async () => root.unmount());
  await external.close();
  await transport.close();
  await host.close();
}

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

function createConversationSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-ui",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-02T08:00:00.000Z",
      updatedAt: "2026-08-02T08:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-02T08:00:00.000Z",
    }),
  });
}

async function waitForReact(predicate) {
  await act(async () => waitFor(predicate));
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Conversation Timeline");
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

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() { return this; },
  };
}
