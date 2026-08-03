import assert from "node:assert/strict";
import {
  ApiTransportDisconnectedError,
  ApiTransportError,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import {
  WEB_API_SUBSCRIPTION_PATH,
  WEB_API_WEBSOCKET_PROTOCOL,
  WebSocketEventClient,
} from "../dist/index.js";

class FakeWebSocket {
  readyState = 0;
  sent = [];
  closeCalls = [];
  listeners = new Map();

  constructor(protocol = WEB_API_WEBSOCKET_PROTOCOL) {
    this.protocol = protocol;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data) {
    if (this.readyState !== 1) throw new Error("socket not open");
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
    this.emit("message", {
      data: typeof value === "string" ? value : JSON.stringify(value),
    });
  }

  binary(value) {
    this.emit("message", { data: value });
  }

  error() {
    this.emit("error", {});
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

await assertEventLifecycle();
await assertExplicitCloseAndClientClose();
await assertProtocolFailures();
await assertBackpressureAndAbort();
await assertOriginAndConnectionFailures();

console.log("websocket event client smoke passed");

async function assertEventLifecycle() {
  const sockets = [];
  const logs = [];
  const client = createClient(sockets, { logger: createCollectingLogger(logs) });
  const request = createRequest("subscription-events");
  const subscription = client.subscribe(request);
  const socket = sockets[0];
  const pending = subscription.next();

  assert.equal(client.endpoint, `wss://novel.example${WEB_API_SUBSCRIPTION_PATH}`);
  assert.equal(subscription.id, "websocket:subscription-events");
  assert.equal(socket.requestedProtocol, WEB_API_WEBSOCKET_PROTOCOL);
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    protocolVersion: 1,
    kind: "open",
    subscriptionId: subscription.id,
    request,
  });
  socket.message(opened(subscription.id));
  socket.message(eventMessage(subscription.id, "conversation-events", 1));
  const first = await pending;
  assert.equal(first.done, false);
  assert.equal(first.value.subscriptionId, subscription.id);
  assert.equal(first.value.event.sequence, 1);

  const donePending = subscription.next();
  socket.message(done(subscription.id));
  assert.deepEqual(await donePending, { done: true, value: undefined });
  assert.deepEqual(socket.closeCalls, [{ code: 1000, reason: "complete" }]);
  assert.equal(JSON.stringify(logs).includes("private-conversation-text"), false);
  await client.close();
}

async function assertExplicitCloseAndClientClose() {
  const sockets = [];
  const client = createClient(sockets);
  const first = client.subscribe(createRequest("subscription-close"));
  sockets[0].open();
  sockets[0].message(opened(first.id));
  await first.close();
  assert.deepEqual(JSON.parse(sockets[0].sent[1]), {
    protocolVersion: 1,
    kind: "close",
    subscriptionId: first.id,
  });
  assert.deepEqual(await first.next(), { done: true, value: undefined });

  const second = client.subscribe(createRequest("subscription-client-close"));
  sockets[1].open();
  sockets[1].message(opened(second.id));
  await client.close();
  await client.close();
  assert.equal(sockets[1].closeCalls.length, 1);
  assert.throws(
    () => client.subscribe(createRequest("subscription-after-close")),
    ApiTransportDisconnectedError,
  );
}

async function assertProtocolFailures() {
  await assertSocketFailure(
    (socket, subscription) => {
      socket.open();
      socket.message(opened("websocket:wrong-id"));
      void subscription;
    },
    "WEB_SOCKET_PROTOCOL_ERROR",
  );
  await assertSocketFailure(
    (socket) => {
      socket.open();
      socket.binary(new Uint8Array([1, 2, 3]));
    },
    "WEB_SOCKET_PROTOCOL_ERROR",
  );
  await assertSocketFailure(
    (socket, subscription) => {
      socket.open();
      socket.message(eventMessage(subscription.id, "conversation-order", 1));
    },
    "WEB_SOCKET_PROTOCOL_ERROR",
  );
  await assertSocketFailure(
    (socket, subscription) => {
      socket.open();
      socket.message(opened(subscription.id));
      socket.message({
        protocolVersion: 1,
        kind: "event",
        subscriptionId: subscription.id,
        frame: { protocolVersion: 1, subscriptionId: subscription.id },
      });
    },
    "WEB_SOCKET_PROTOCOL_ERROR",
  );
  await assertSocketFailure(
    (socket, subscription) => {
      socket.open();
      socket.message(opened(subscription.id));
      socket.message({
        protocolVersion: 1,
        kind: "error",
        subscriptionId: subscription.id,
        error: { code: "AUTHENTICATION_REQUIRED", retryable: false },
      });
    },
    "AUTHENTICATION_REQUIRED",
  );

  const sockets = [];
  const client = createClient(sockets, { protocol: "wrong.protocol" });
  const subscription = client.subscribe(createRequest("subscription-protocol"));
  const pending = subscription.next();
  sockets[0].open();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "WEB_SOCKET_PROTOCOL_ERROR",
  );
  await client.close();
}

async function assertBackpressureAndAbort() {
  const sockets = [];
  const client = createClient(sockets, { maxQueuedFrames: 1 });
  const subscription = client.subscribe(createRequest("subscription-overflow"));
  sockets[0].open();
  sockets[0].message(opened(subscription.id));
  sockets[0].message(eventMessage(subscription.id, "conversation-overflow", 1));
  sockets[0].message(eventMessage(subscription.id, "conversation-overflow", 2));
  await assert.rejects(
    subscription.next(),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "WEB_SOCKET_BACKPRESSURE_OVERFLOW",
  );
  await client.close();

  const abortSockets = [];
  const abortClient = createClient(abortSockets);
  const controller = new AbortController();
  const aborted = abortClient.subscribe(createRequest("subscription-abort"), {
    signal: controller.signal,
  });
  const pending = aborted.next();
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(abortSockets[0].closeCalls.length, 1);
  await abortClient.close();
}

async function assertOriginAndConnectionFailures() {
  for (const origin of ["file:///application", "https://user@novel.example", "https://novel.example/path"]) {
    assert.throws(
      () => new WebSocketEventClient({ origin, createSocket: () => new FakeWebSocket() }),
      (error) =>
        error instanceof ApiTransportError &&
        error.code === "WEB_SOCKET_ORIGIN_INVALID",
    );
  }
  const privateFailure = "private socket construction failure";
  const client = new WebSocketEventClient({
    origin: "https://novel.example",
    createSocket: () => {
      throw new Error(privateFailure);
    },
  });
  assert.throws(
    () => client.subscribe(createRequest("subscription-connect-failure")),
    (error) =>
      error instanceof ApiTransportDisconnectedError &&
      !error.message.includes(privateFailure),
  );
}

async function assertSocketFailure(trigger, code) {
  const sockets = [];
  const client = createClient(sockets);
  const subscription = client.subscribe(createRequest(`subscription-${code}`));
  const pending = subscription.next();
  trigger(sockets[0], subscription);
  await assert.rejects(
    pending,
    (error) => error instanceof ApiTransportError && error.code === code,
  );
  assert.equal(sockets[0].closeCalls.length, 1);
  await client.close();
}

function createClient(sockets, options = {}) {
  return new WebSocketEventClient({
    origin: "https://novel.example",
    createSocket: (url, requestedProtocol) => {
      const socket = new FakeWebSocket(options.protocol);
      socket.url = url;
      socket.requestedProtocol = requestedProtocol;
      sockets.push(socket);
      return socket;
    },
    ...(options.maxQueuedFrames !== undefined
      ? { maxQueuedFrames: options.maxQueuedFrames }
      : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });
}

function createRequest(requestId) {
  return {
    protocolVersion: 1,
    requestId,
    operation: "conversation.events.subscribe",
    payload: { conversationId: `conversation-${requestId}` },
  };
}

function opened(subscriptionId) {
  return { protocolVersion: 1, kind: "opened", subscriptionId };
}

function done(subscriptionId) {
  return { protocolVersion: 1, kind: "done", subscriptionId };
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
