import assert from "node:assert/strict";
import {
  ApiTransportDisconnectedError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import {
  HttpWebSocketApiTransport,
  WEB_API_WEBSOCKET_PROTOCOL,
} from "../dist/index.js";

class FakeWebSocket {
  readyState = 0;
  protocol = WEB_API_WEBSOCKET_PROTOCOL;
  sent = [];
  closeCalls = [];
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit("close", {});
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(value) {
    this.emit("message", { data: JSON.stringify(value) });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

await assertCoreClientIntegration();
await assertCloseCancelsActiveRequests();
await assertCallerCancellation();

console.log("http websocket transport smoke passed");

async function assertCoreClientIntegration() {
  const sockets = [];
  const logs = [];
  const conversationId = "conversation-web-transport";
  const requestIds = ["request-open", "request-events"];
  const transport = new HttpWebSocketApiTransport({
    origin: "https://novel.example",
    fetch: async (_input, init) => {
      const request = JSON.parse(init.body);
      return jsonResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: createConversationSnapshot(conversationId),
      });
    },
    createSocket: (_url, protocol) => {
      assert.equal(protocol, WEB_API_WEBSOCKET_PROTOCOL);
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
    logger: createCollectingLogger(logs),
  });
  const api = new DefaultNovelApiClient({
    transport,
    requestIdFactory: () => requestIds.shift(),
  });
  const conversation = await api.conversations.open(conversationId);
  const events = conversation.events.subscribe({ start: { from: "start" } });
  const pending = events.next();
  const socket = sockets[0];
  socket.open();
  assert.equal(JSON.parse(socket.sent[0]).subscriptionId, "websocket:request-events");
  socket.message(opened("websocket:request-events"));
  socket.message(eventMessage("websocket:request-events", conversationId, 1));
  const event = await pending;

  assert.equal(event.done, false);
  assert.equal(event.value.conversationId, conversationId);
  assert.equal(event.value.sequence, 1);
  assert.equal(events.id, "websocket:request-events");
  await events.close();
  await transport.close();
  await transport.close();
  assert.equal(socket.closeCalls.length, 1);
  assert.equal(JSON.stringify(logs).includes("private-conversation-text"), false);
  await assert.rejects(
    transport.request(createRequest("request-after-close")),
    ApiTransportDisconnectedError,
  );
  assert.throws(
    () => transport.subscribe(createRequest("subscription-after-close")),
    ApiTransportDisconnectedError,
  );
}

async function assertCloseCancelsActiveRequests() {
  let requestStarted = false;
  const transport = new HttpWebSocketApiTransport({
    origin: "https://novel.example",
    fetch: async (_input, init) => {
      requestStarted = true;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      });
    },
    createSocket: () => new FakeWebSocket(),
  });
  const pending = transport.request(createRequest("request-close-cancel"));
  await waitFor(() => requestStarted);
  const closing = transport.close();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  await closing;
}

async function assertCallerCancellation() {
  const controller = new AbortController();
  const transport = new HttpWebSocketApiTransport({
    origin: "https://novel.example",
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      }),
    createSocket: () => new FakeWebSocket(),
  });
  const pending = transport.request(createRequest("request-caller-abort"), {
    signal: controller.signal,
  });
  controller.abort(new DOMException("caller cancelled", "AbortError"));
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  await transport.close();
}

function createRequest(requestId) {
  return {
    protocolVersion: 1,
    requestId,
    operation: "test.request",
    payload: null,
  };
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

function opened(subscriptionId) {
  return { protocolVersion: 1, kind: "opened", subscriptionId };
}

function eventMessage(subscriptionId, conversationId, sequence) {
  const input = new UserMessageInputEvent({
    id: `input-${sequence}`,
    conversationId,
    timestamp: "2026-08-03T00:00:01.000Z",
    text: "private-conversation-text",
  }).getSnapshot();
  return {
    protocolVersion: 1,
    kind: "event",
    subscriptionId,
    frame: {
      protocolVersion: 1,
      subscriptionId,
      event: {
        ...input,
        direction: "input",
        sequence,
        recordedAt: "2026-08-03T00:00:02.000Z",
      },
    },
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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
    if (Date.now() >= deadline) throw new Error("Timed out waiting for request");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
