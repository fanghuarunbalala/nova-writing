import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import {
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import {
  DeterministicMockClock,
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockHttpWebSocketApiTransport,
  MockTransportFaultController,
} from "../../core/dist/testing/index.js";
import {
  NovelApiProvider,
  useConversationProjection,
} from "../dist/index.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
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
const { createRoot } = await import("react-dom/client");

const transportCases = [
  ["electron", MockElectronApiTransport],
  ["http-websocket", MockHttpWebSocketApiTransport],
];

for (const [name, Transport] of transportCases) {
  await runHookContract(name, Transport);
}

console.log("conversation projection hook smoke passed");

async function runHookContract(name, Transport) {
  const logs = [];
  const logger = createCollectingLogger(logs);
  const host = new DeterministicMockNovelHost({
    clock: new DeterministicMockClock({
      start: "2026-08-02T06:00:00.000Z",
    }),
    logger,
  });
  const conversationId = `conversation-ui-hook-${name}`;
  host.registerConversation({
    snapshot: createSnapshot(conversationId),
    runtimePresence: {
      state: "offline",
      observedAt: "2026-08-02T06:00:00.000Z",
    },
  });
  const faults = new MockTransportFaultController();
  const transport = new Transport({ host, faultController: faults, logger });
  const api = new DefaultNovelApiClient({ transport, logger });
  const externalConversation = await api.conversations.open(conversationId);
  const secretText = `private-ui-hook-${name}-novel-text`;
  await externalConversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-ui-history`,
      timestamp: "2026-08-02T06:00:01.000Z",
      text: secretText,
    }),
  );

  let latest;
  let renderCount = 0;
  function ProjectionProbe() {
    latest = useConversationProjection(conversationId);
    renderCount += 1;
    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        NovelApiProvider,
        { api, logger },
        createElement(ProjectionProbe),
      ),
    );
  });
  await waitForReact(
    () => latest?.snapshot.controller?.state === "live",
  );
  assert.equal(latest.snapshot.state, "active");
  assert.equal(latest.snapshot.projection.lastAppliedSequence, 1);
  assert.equal(latest.snapshot.projection.userMessages[0].text, secretText);
  assert.equal(latest.snapshot.controller.runtimePresence.state, "offline");
  assert.ok(Object.isFrozen(latest.snapshot));
  assert.ok(Object.isFrozen(latest.snapshot.projection));

  await act(async () => {
    await externalConversation.input.enqueue(
      new UserMessageInputEvent({
        id: `evt-${name}-ui-live`,
        timestamp: "2026-08-02T06:00:02.000Z",
        text: "live through shared React UI",
      }),
    );
    await waitFor(
      () => latest?.snapshot.projection.lastAppliedSequence === 2,
    );
  });

  await act(async () => {
    faults.disconnect();
    await waitFor(
      () => latest?.snapshot.controller?.state === "disconnected",
    );
  });
  assert.deepEqual(latest.snapshot.error, {
    code: "API_TRANSPORT_DISCONNECTED",
    retryable: true,
    category: "transport",
  });

  await host.appendOutput({
    id: `evt-${name}-ui-offline`,
    conversationId,
    eventType: "novel.ui.offline.persisted",
    schemaVersion: 1,
    timestamp: "2026-08-02T06:00:03.000Z",
    payload: { privateText: secretText },
  });
  faults.reconnect();
  await act(async () => {
    await latest.resume();
  });
  assert.equal(latest.snapshot.controller.state, "live");
  assert.equal(latest.snapshot.projection.lastAppliedSequence, 3);
  assert.equal(latest.snapshot.error, undefined);

  const rendersBeforeUnmount = renderCount;
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await waitFor(() =>
    logs.some(
      (entry) =>
        entry.event === "novel_ui.conversation_projection.stopped",
    ),
  );
  await externalConversation.input.enqueue(
    new UserMessageInputEvent({
      id: `evt-${name}-ui-after-unmount`,
      timestamp: "2026-08-02T06:00:04.000Z",
      text: "external handle remains usable",
    }),
  );
  await delay(20);
  assert.equal(renderCount, rendersBeforeUnmount);
  assert.equal(JSON.stringify(logs).includes(secretText), false);

  await externalConversation.close();
  await transport.close();
  await host.close();
}

function createSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-ui-hook",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-02T06:00:00.000Z",
      updatedAt: "2026-08-02T06:00:00.000Z",
      lastJournalSequence: 0,
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-02T06:00:00.000Z",
    }),
  });
}

async function waitForReact(predicate) {
  await act(async () => {
    await waitFor(predicate);
  });
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for shared React projection state");
    }
    await delay(5);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() {
      return this;
    },
  };
}
