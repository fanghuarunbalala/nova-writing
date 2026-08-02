import assert from "node:assert/strict";
import {
  RuntimeIpcBackpressureError,
  RuntimeIpcConnectionBackpressureError,
  RuntimeIpcPeer,
  RuntimeIpcPeerClosedError,
  RuntimeIpcPeerStateError,
  RuntimeIpcRemoteError,
  RuntimeIpcRequestCancelledError,
  captureRuntimeIpcFrame,
  createInMemoryRuntimeIpcConnectionPair,
} from "../dist/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

class ControlledConnection {
  constructor() {
    this.sent = [];
    this.releases = [];
    this.closed = false;
  }
  async send(frame) {
    if (this.closed) throw new RuntimeIpcPeerClosedError();
    this.sent.push(captureRuntimeIpcFrame(frame));
    await new Promise((resolve) => this.releases.push(resolve));
  }
  releaseOne() { this.releases.shift()?.(); }
  next() { return new Promise(() => {}); }
  [Symbol.asyncIterator]() { return this; }
  async close() {
    this.closed = true;
    while (this.releases.length > 0) this.releaseOne();
  }
}

const privatePayload = "DO_NOT_LOG_RUNTIME_IPC_PEER_PAYLOAD";
const logs = [];
const notifications = [];
const pair = createInMemoryRuntimeIpcConnectionPair();
const server = new RuntimeIpcPeer({
  sessionId: "session-basic",
  connection: pair.second,
  requestHandler: {
    async handle(method, payload) {
      if (method === "test.fail") throw new Error(privatePayload);
      await delay(payload.delayMs ?? 0);
      return { method, value: payload.value };
    },
  },
  notificationHandler: {
    async handle(method, payload) { notifications.push({ method, payload }); },
  },
  logger: new CollectingLogger(logs),
});
const client = new RuntimeIpcPeer({
  sessionId: "session-basic",
  connection: pair.first,
  logger: new CollectingLogger(logs),
});
server.start();
client.start();
assert.throws(() => client.start(), RuntimeIpcPeerStateError);

const completionOrder = [];
const slow = client.request("test.echo", { value: "slow", delayMs: 20 })
  .then((result) => { completionOrder.push(result.value); return result; });
const fast = client.request("test.echo", { value: "fast", delayMs: 0 })
  .then((result) => { completionOrder.push(result.value); return result; });
assert.deepEqual(await fast, { method: "test.echo", value: "fast" });
assert.deepEqual(await slow, { method: "test.echo", value: "slow" });
assert.deepEqual(completionOrder, ["fast", "slow"]);
await client.notify("runtime.progress", { completed: 1 });
await waitFor(() => notifications.length === 1);
assert.deepEqual(notifications, [{
  method: "runtime.progress",
  payload: { completed: 1 },
}]);
await assert.rejects(
  client.request("test.fail", { secret: privatePayload }),
  (error) =>
    error instanceof RuntimeIpcRemoteError &&
    error.code === "IPC_REQUEST_HANDLER_FAILED" &&
    error.category === "internal",
);
assert.equal(JSON.stringify(logs).includes(privatePayload), false);
await Promise.all([client.close(), server.close()]);

let duplicateCalls = 0;
const duplicatePair = createInMemoryRuntimeIpcConnectionPair();
const duplicateServer = new RuntimeIpcPeer({
  sessionId: "session-duplicate",
  connection: duplicatePair.second,
  requestHandler: {
    async handle(_method, payload) {
      duplicateCalls += 1;
      return { echoed: payload.value };
    },
  },
});
const duplicateClient = new RuntimeIpcPeer({
  sessionId: "session-duplicate",
  connection: duplicatePair.first,
  requestIdFactory: { create() { return "request-duplicate"; } },
});
duplicateServer.start();
duplicateClient.start();
assert.deepEqual(
  await duplicateClient.request("test.echo", { value: "same" }),
  { echoed: "same" },
);
assert.deepEqual(
  await duplicateClient.request("test.echo", { value: "same" }),
  { echoed: "same" },
);
assert.equal(duplicateCalls, 1);
await assert.rejects(
  duplicateClient.request("test.echo", { value: "changed" }),
  (error) =>
    (error instanceof RuntimeIpcRemoteError && error.code === "IPC_REQUEST_CONFLICT") ||
    error instanceof RuntimeIpcPeerClosedError,
);
await Promise.all([duplicateClient.waitForClose(), duplicateServer.waitForClose()]);

const cancellationPair = createInMemoryRuntimeIpcConnectionPair();
let cancellationObservedResolve;
const cancellationObserved = new Promise((resolve) => {
  cancellationObservedResolve = resolve;
});
const cancellationServer = new RuntimeIpcPeer({
  sessionId: "session-cancel",
  connection: cancellationPair.second,
  requestHandler: {
    async handle(_method, _payload, context) {
      await new Promise((_resolve, reject) => {
        const cancelled = () => {
          cancellationObservedResolve();
          reject(new Error("cancelled"));
        };
        if (context.signal.aborted) cancelled();
        else context.signal.addEventListener("abort", cancelled, { once: true });
      });
      return null;
    },
  },
});
const cancellationClient = new RuntimeIpcPeer({
  sessionId: "session-cancel",
  connection: cancellationPair.first,
});
cancellationServer.start();
cancellationClient.start();
const controller = new AbortController();
const cancelledRequest = cancellationClient.request(
  "runtime.wait",
  {},
  { signal: controller.signal },
);
await delay(0);
controller.abort();
await assert.rejects(cancelledRequest, RuntimeIpcRequestCancelledError);
await cancellationObserved;
await Promise.all([cancellationClient.close(), cancellationServer.close()]);

const priorityConnection = new ControlledConnection();
const priorityPeer = new RuntimeIpcPeer({
  sessionId: "session-priority",
  connection: priorityConnection,
  dataQueueCapacity: 2,
  controlQueueCapacity: 2,
});
priorityPeer.start();
const firstData = priorityPeer.notify("data.first", {}, { lane: "data" });
await waitFor(() => priorityConnection.sent.length === 1);
const secondData = priorityPeer.notify("data.second", {}, { lane: "data" });
const control = priorityPeer.notify("runtime.shutdown", {}, { lane: "control" });
priorityConnection.releaseOne();
await waitFor(() => priorityConnection.sent.length === 2);
assert.equal(priorityConnection.sent[1].method, "runtime.shutdown");
priorityConnection.releaseOne();
await waitFor(() => priorityConnection.sent.length === 3);
assert.equal(priorityConnection.sent[2].method, "data.second");
priorityConnection.releaseOne();
await Promise.all([firstData, secondData, control]);
await priorityPeer.close();

const blockedConnection = new ControlledConnection();
const backpressurePeer = new RuntimeIpcPeer({
  sessionId: "session-backpressure",
  connection: blockedConnection,
  dataQueueCapacity: 1,
});
backpressurePeer.start();
const blockedFirst = backpressurePeer.notify("data.first", {});
await waitFor(() => blockedConnection.sent.length === 1);
const blockedSecond = backpressurePeer.notify("data.second", {});
await assert.rejects(
  backpressurePeer.notify("data.third", {}),
  (error) =>
    error instanceof RuntimeIpcBackpressureError &&
    error.lane === "data" &&
    error.capacity === 1,
);
blockedConnection.releaseOne();
await waitFor(() => blockedConnection.sent.length === 2);
blockedConnection.releaseOne();
await Promise.all([blockedFirst, blockedSecond]);
await backpressurePeer.close();

const capacityPair = createInMemoryRuntimeIpcConnectionPair({ receiveCapacity: 1 });
await capacityPair.first.send(notificationFrame("capacity-1"));
await assert.rejects(
  capacityPair.first.send(notificationFrame("capacity-2")),
  RuntimeIpcConnectionBackpressureError,
);
await capacityPair.first.close();

const closePair = createInMemoryRuntimeIpcConnectionPair();
const closeClient = new RuntimeIpcPeer({
  sessionId: "session-close",
  connection: closePair.first,
});
closeClient.start();
const pendingClose = closeClient.request("runtime.wait", {});
await closePair.second.close();
await assert.rejects(pendingClose, RuntimeIpcPeerClosedError);
await closeClient.waitForClose();

console.log("Runtime IPC Peer smoke passed");

function notificationFrame(notificationId) {
  return {
    frameType: "notification",
    protocolVersion: 1,
    sessionId: "session-capacity",
    notificationId,
    method: "runtime.heartbeat",
    payload: null,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(0);
  }
  assert.fail("condition was not reached");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
