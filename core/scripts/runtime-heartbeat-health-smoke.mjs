import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  RuntimeIpcHeartbeatEmitter,
  RuntimeIpcHeartbeatMonitor,
  captureRuntimeIpcHeartbeat,
} from "../dist/index.js";
import {
  ChildProcessConversationRuntimeHandle,
  RuntimeProcessExitNormalizer,
} from "../dist/node/index.js";

class FakeTimer {
  constructor() { this.time = 0; this.callbacks = new Map(); this.nextId = 0; }
  now() { return this.time; }
  every(intervalMs, callback) {
    const id = ++this.nextId;
    this.callbacks.set(id, { intervalMs, next: this.time + intervalMs, callback });
    return id;
  }
  cancel(id) { this.callbacks.delete(id); }
  advance(durationMs) {
    const target = this.time + durationMs;
    while (true) {
      const due = [...this.callbacks.entries()]
        .filter(([, item]) => item.next <= target)
        .sort((left, right) => left[1].next - right[1].next)[0];
      if (!due) break;
      this.time = due[1].next;
      due[1].next += due[1].intervalMs;
      due[1].callback();
    }
    this.time = target;
  }
}

class FakeProcess {
  constructor({ settleOnTerminate }) {
    this.stdin = {};
    this.stdout = {};
    this.signals = [];
    this.settleOnTerminate = settleOnTerminate;
    this.exit = new Promise((resolve) => { this.resolveExit = resolve; });
  }
  waitForExit() { return this.exit; }
  terminate(signal) {
    this.signals.push(signal);
    if (signal === this.settleOnTerminate) {
      this.resolveExit({ kind: "exited", code: null, signal });
    }
    return true;
  }
}

const timer = new FakeTimer();
const sent = [];
const emitter = new RuntimeIpcHeartbeatEmitter({
  async notify(method, payload, options) { sent.push({ method, payload, options }); },
}, timer, 20);
emitter.start();
timer.advance(40);
emitter.stop();
assert.equal(sent.length, 3);
assert.equal(sent.every((entry) => entry.method === "runtime.heartbeat"), true);
assert.equal(sent.every((entry) => entry.options.lane === "control"), true);
assert.deepEqual(sent.map((entry) => entry.payload.sequence), [1, 2, 3]);
assert.equal(Object.isFrozen(captureRuntimeIpcHeartbeat(sent[0].payload)), true);

const monitorTimer = new FakeTimer();
const monitor = new RuntimeIpcHeartbeatMonitor(monitorTimer, 20, 3);
let unhealthy = false;
void monitor.waitForUnhealthy().then(() => { unhealthy = true; });
monitor.start();
monitorTimer.advance(40);
await monitor.handle("runtime.heartbeat", { sequence: 1, sentAt: new Date(40).toISOString() });
monitorTimer.advance(59);
await Promise.resolve();
assert.equal(unhealthy, false);
assert.equal(monitor.state, "healthy");
monitorTimer.advance(1);
await monitor.waitForUnhealthy();
assert.equal(monitor.state, "unhealthy");
assert.throws(() => captureRuntimeIpcHeartbeat({ sequence: 1, sentAt: "bad", path: "/private" }));

const forcedProcess = new FakeProcess({ settleOnTerminate: "SIGKILL" });
const forcedHandle = new ChildProcessConversationRuntimeHandle({
  conversationId: "conversation-forced",
  runtimeInstanceId: "runtime-forced",
  process: forcedProcess,
  connection: { async send() {}, async next() { return { done: true }; }, async close() {}, [Symbol.asyncIterator]() { return this; } },
  endpoint: { async dispatchInput() {}, async shutdown() { return new Promise(() => {}); }, async close() {} },
  gracefulTerminationTimeoutMs: 10,
  exitNormalizer: new RuntimeProcessExitNormalizer({ clock: { now: () => "2026-08-02T00:00:00.000Z" } }),
});
await forcedHandle.shutdown({ reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown });
assert.deepEqual(forcedProcess.signals, ["SIGKILL"]);
assert.deepEqual(await forcedHandle.waitForExit(), {
  kind: "stopped",
  exitedAt: "2026-08-02T00:00:00.000Z",
  reason: "explicit_shutdown",
});

let markUnhealthy;
const unhealthySignal = new Promise((resolve) => { markUnhealthy = resolve; });
const unhealthyProcess = new FakeProcess({ settleOnTerminate: "SIGTERM" });
const unhealthyHandle = new ChildProcessConversationRuntimeHandle({
  conversationId: "conversation-unhealthy",
  runtimeInstanceId: "runtime-unhealthy",
  process: unhealthyProcess,
  connection: { async send() {}, async next() { return { done: true }; }, async close() {}, [Symbol.asyncIterator]() { return this; } },
  endpoint: {
    async dispatchInput() {}, async shutdown() {}, async close() {},
    waitForUnhealthy() { return unhealthySignal; },
  },
  gracefulTerminationTimeoutMs: 10,
  exitNormalizer: new RuntimeProcessExitNormalizer({ clock: { now: () => "2026-08-02T00:00:01.000Z" } }),
});
markUnhealthy();
assert.equal((await unhealthyHandle.waitForExit()).kind, "crashed");
assert.deepEqual(unhealthyProcess.signals, ["SIGTERM"]);

console.log("Runtime heartbeat health smoke passed");
