import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ApiTransportDisconnectedError,
  ApiTransportError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import { ElectronApiTransport } from "../dist/renderer/index.js";

async function assertRequestRoundTripAndRedaction() {
  const logs = [];
  const privateText = "private-renderer-request-payload";
  const bridge = new TestElectronBridge();
  bridge.requestHandler = async (request) => ({
    ok: true,
    value: {
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      ok: true,
      data: { accepted: true, privateText },
    },
  });
  const transport = new ElectronApiTransport({
    bridge,
    logger: createCollectingLogger(logs),
  });
  const request = createRequest("request-success", "test.request", {
    privateText,
  });
  const response = await transport.request(request);

  assert.equal(response.ok, true);
  assert.equal(response.data.accepted, true);
  assert.notEqual(bridge.requests[0], request);
  assert.deepEqual(bridge.requests[0], request);
  assert.equal(JSON.stringify(logs).includes(privateText), false);
  await transport.close();
}

async function assertRequestCancellation() {
  const bridge = new TestElectronBridge();
  let settleRequest;
  bridge.requestHandler = () =>
    new Promise((resolve) => {
      settleRequest = resolve;
    });
  const transport = new ElectronApiTransport({ bridge });
  const controller = new AbortController();
  const pending = transport.request(
    createRequest("request-cancel", "test.cancel", null),
    { signal: controller.signal },
  );
  controller.abort(new DOMException("cancelled", "AbortError"));

  await assert.rejects(pending, (error) => error?.name === "AbortError");
  await waitFor(() => bridge.cancelledRequestIds.length === 1);
  assert.deepEqual(bridge.cancelledRequestIds, ["request-cancel"]);
  settleRequest(successResponse("request-cancel", null));
  await transport.close();
}

async function assertSubscriptionLifecycle() {
  const bridge = new TestElectronBridge();
  const request = createRequest("subscription-lifecycle", "test.subscribe", null);
  const subscriptionId = "electron:subscription-lifecycle";
  bridge.subscriptionReads.set(subscriptionId, [
    {
      done: false,
      frame: createInputFrame(subscriptionId, "conversation-subscription", 1),
    },
    { done: true },
  ]);
  const transport = new ElectronApiTransport({ bridge });
  const subscription = transport.subscribe(request);

  assert.equal(subscription.id, subscriptionId);
  const first = await subscription.next();
  assert.equal(first.done, false);
  assert.equal(first.value.subscriptionId, subscriptionId);
  const done = await subscription.next();
  assert.equal(done.done, true);
  assert.deepEqual(bridge.openedSubscriptions.map((entry) => entry.subscriptionId), [
    subscriptionId,
  ]);
  assert.deepEqual(bridge.readSubscriptionIds, [subscriptionId, subscriptionId]);
  await transport.close();
}

async function assertConversationClientIntegration() {
  const conversationId = "conversation-client-integration";
  const requestIds = ["request-open", "request-events"];
  const bridge = new TestElectronBridge();
  bridge.requestHandler = async (request) => {
    assert.equal(request.operation, "conversation.snapshot.get");
    return successResponse(request.requestId, createConversationSnapshot(conversationId));
  };
  bridge.openSubscriptionHandler = async ({ subscriptionId, request }) => {
    assert.equal(request.operation, "conversation.events.subscribe");
    assert.equal(subscriptionId, "electron:request-events");
    bridge.subscriptionReads.set(subscriptionId, [
      {
        done: false,
        frame: createInputFrame(subscriptionId, conversationId, 1),
      },
    ]);
    return acknowledgement();
  };
  const transport = new ElectronApiTransport({ bridge });
  const api = new DefaultNovelApiClient({
    transport,
    requestIdFactory: () => requestIds.shift(),
  });
  const conversation = await api.conversations.open(conversationId);
  const events = conversation.events.subscribe({ start: { from: "start" } });
  const event = await events.next();

  assert.equal(event.done, false);
  assert.equal(event.value.conversationId, conversationId);
  assert.equal(event.value.sequence, 1);
  await events.close();
  assert.deepEqual(bridge.closedSubscriptionIds, ["electron:request-events"]);
  await transport.close();
}

async function assertConversationClientRejectsMismatchedSubscription() {
  const conversationId = "conversation-mismatched-subscription";
  const requestIds = ["request-open-mismatch", "request-events-mismatch"];
  const expectedSubscriptionId = "electron:request-events-mismatch";
  const bridge = new TestElectronBridge();
  bridge.requestHandler = async (request) =>
    successResponse(request.requestId, createConversationSnapshot(conversationId));
  bridge.openSubscriptionHandler = async () => {
    bridge.subscriptionReads.set(expectedSubscriptionId, [
      {
        done: false,
        frame: createInputFrame("electron:wrong-subscription", conversationId, 1),
      },
    ]);
    return acknowledgement();
  };
  const transport = new ElectronApiTransport({ bridge });
  const api = new DefaultNovelApiClient({
    transport,
    requestIdFactory: () => requestIds.shift(),
  });
  const conversation = await api.conversations.open(conversationId);
  const events = conversation.events.subscribe({ start: { from: "start" } });

  await assert.rejects(
    events.next(),
    /subscriptionId does not match the active subscription/,
  );
  assert.deepEqual(bridge.closedSubscriptionIds, [expectedSubscriptionId]);
  await transport.close();
}

async function assertSubscriptionReadFailureCleansUp() {
  const subscriptionId = "electron:subscription-read-failure";
  const bridge = new TestElectronBridge();
  bridge.readSubscriptionHandler = async () => ({
    ok: false,
    error: { code: "ELECTRON_READ_FAILED", retryable: true },
  });
  const transport = new ElectronApiTransport({ bridge });
  const subscription = transport.subscribe(
    createRequest("subscription-read-failure", "test.subscribe", null),
  );

  await assert.rejects(
    subscription.next(),
    (error) =>
      error instanceof ApiTransportError && error.code === "ELECTRON_READ_FAILED",
  );
  assert.deepEqual(bridge.closedSubscriptionIds, [subscriptionId]);
  await transport.close();
}

async function assertBridgeFailureMapping() {
  const privateError = "private-main-process-error";
  const structured = new TestElectronBridge();
  structured.requestHandler = async () => ({
    ok: false,
    error: {
      code: "ELECTRON_TEST_FAILURE",
      retryable: false,
      privateError,
    },
  });
  const structuredTransport = new ElectronApiTransport({ bridge: structured });
  await assert.rejects(
    structuredTransport.request(createRequest("request-failure", "test.failure", null)),
    (error) => {
      assert.ok(error instanceof ApiTransportError);
      assert.equal(error.code, "ELECTRON_TEST_FAILURE");
      assert.equal(error.retryable, false);
      assert.equal(error.message.includes(privateError), false);
      return true;
    },
  );
  await structuredTransport.close();

  const rejected = new TestElectronBridge();
  rejected.requestHandler = async () => {
    throw new Error(privateError);
  };
  const rejectedTransport = new ElectronApiTransport({ bridge: rejected });
  await assert.rejects(
    rejectedTransport.request(createRequest("request-rejected", "test.failure", null)),
    (error) => {
      assert.ok(error instanceof ApiTransportDisconnectedError);
      assert.equal(error.message.includes(privateError), false);
      return true;
    },
  );
  await rejectedTransport.close();

  const invalid = new TestElectronBridge();
  invalid.requestHandler = async () => ({ ok: true, value: 1n });
  const invalidTransport = new ElectronApiTransport({ bridge: invalid });
  await assert.rejects(
    invalidTransport.request(createRequest("request-invalid", "test.invalid", null)),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "ELECTRON_BRIDGE_PROTOCOL_ERROR",
  );
  await invalidTransport.close();
}

async function assertTransportCloseCleanup() {
  const bridge = new TestElectronBridge();
  const transport = new ElectronApiTransport({ bridge });
  transport.subscribe(createRequest("subscription-close-1", "test.subscribe", null));
  transport.subscribe(createRequest("subscription-close-2", "test.subscribe", null));

  await transport.close();
  await transport.close();
  assert.deepEqual(new Set(bridge.closedSubscriptionIds), new Set([
    "electron:subscription-close-1",
    "electron:subscription-close-2",
  ]));
  await assert.rejects(
    transport.request(createRequest("request-after-close", "test.request", null)),
    ApiTransportDisconnectedError,
  );
}

async function assertRendererSourceBoundary() {
  const source = await readFile(
    new URL("../src/renderer/transport/ElectronApiTransport.ts", import.meta.url),
    "utf8",
  );
  const forbidden = [
    /from\s+["']electron["']/,
    /from\s+["']node:/,
    /\bipcRenderer\b/,
    /\bchild_process\b/,
    /\bprocess\s*\./,
    /from\s+["'](?:node:)?fs(?:\/promises)?["']/,
  ];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(source), false, `forbidden Renderer source: ${pattern}`);
  }
}

class TestElectronBridge {
  requests = [];
  cancelledRequestIds = [];
  openedSubscriptions = [];
  readSubscriptionIds = [];
  closedSubscriptionIds = [];
  subscriptionReads = new Map();
  requestHandler = async (request) => successResponse(request.requestId, null);
  openSubscriptionHandler = async () => acknowledgement();
  readSubscriptionHandler = async (subscriptionId) => {
    const reads = this.subscriptionReads.get(subscriptionId) ?? [];
    return { ok: true, value: reads.shift() ?? { done: true } };
  };

  async request(request) {
    this.requests.push(request);
    return this.requestHandler(request);
  }

  async cancelRequest(requestId) {
    this.cancelledRequestIds.push(requestId);
    return acknowledgement();
  }

  async openSubscription(request) {
    this.openedSubscriptions.push(request);
    return this.openSubscriptionHandler(request);
  }

  async readSubscription(subscriptionId) {
    this.readSubscriptionIds.push(subscriptionId);
    return this.readSubscriptionHandler(subscriptionId);
  }

  async closeSubscription(subscriptionId) {
    this.closedSubscriptionIds.push(subscriptionId);
    return acknowledgement();
  }
}

function createRequest(requestId, operation, payload) {
  return { protocolVersion: 1, requestId, operation, payload };
}

function successResponse(requestId, data) {
  return {
    ok: true,
    value: { protocolVersion: 1, requestId, ok: true, data },
  };
}

function acknowledgement() {
  return { ok: true, value: { acknowledged: true } };
}

function createConversationSnapshot(conversationId) {
  return {
    metadata: {
      id: conversationId,
      workspaceId: "workspace-1",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      lastJournalSequence: 1,
    },
    activeAgentBinding: {
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
    },
  };
}

function createInputFrame(subscriptionId, conversationId, sequence) {
  const input = new UserMessageInputEvent({
    id: `input-${sequence}`,
    conversationId,
    timestamp: "2026-08-03T00:00:01.000Z",
    text: "private-conversation-text",
  }).getSnapshot();
  return {
    protocolVersion: 1,
    subscriptionId,
    event: {
      ...input,
      direction: "input",
      sequence,
      recordedAt: "2026-08-03T00:00:02.000Z",
    },
  };
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

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for cancellation");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

await assertRequestRoundTripAndRedaction();
await assertRequestCancellation();
await assertSubscriptionLifecycle();
await assertConversationClientIntegration();
await assertConversationClientRejectsMismatchedSubscription();
await assertSubscriptionReadFailureCleansUp();
await assertBridgeFailureMapping();
await assertTransportCloseCleanup();
await assertRendererSourceBoundary();

console.log("electron api transport smoke passed");
