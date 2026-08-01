import assert from "node:assert/strict";
import {
  InputRouter,
  RuntimeInputConflictError,
  RuntimeInputQueueFullError,
  RuntimeInputRejectedError,
} from "../dist/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) { this.entries.push({ level, event, fields: { ...this.bindings, ...fields } }); }
}

function input(sequence, eventType, priority, payload = {}) {
  return {
    id: `input-router-${sequence}`,
    conversationId: "conversation-router",
    eventType,
    schemaVersion: 1,
    priority,
    timestamp: `2026-08-01T07:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
    direction: "input",
    sequence,
    recordedAt: `2026-08-01T07:01:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

const logs = [];
const router = new InputRouter({
  conversationId: "conversation-router",
  controlCapacity: 4,
  turnCapacity: 5,
  logger: new CollectingLogger(logs),
});
const secret = "FORBIDDEN_ROUTER_NOVEL_TEXT";
const user1 = input(1, "user.message", 500, { text: secret });
const context2 = input(2, "context.clear", 400, {});
const reload3 = input(3, "command.config.reload", 900, {});
const stop4 = input(4, "system.stop", 1000, {});
const user5 = input(5, "user.message", 500, { text: "later" });

assert.equal(router.route(user1).lane, "turn");
user1.payload.text = "mutated";
assert.equal(router.route(context2).lane, "turn");
assert.equal(router.route(reload3).lane, "control");
assert.equal(router.route(stop4).lane, "control");
assert.equal(router.route(user5).lane, "turn");
assert.equal(router.peekNext().sequence, 4);
assert.equal(router.dequeueNext().sequence, 4);
assert.equal(router.peekNext().sequence, 3);
assert.equal(router.dequeueNext().sequence, 3);
assert.equal(router.peekNext().sequence, 1);

const cancelled = router.applyStopFence(4);
assert.deepEqual(cancelled.map((event) => event.sequence), [1, 2]);
assert.equal(cancelled[0].payload.text, secret);
assert.equal(Object.isFrozen(cancelled), true);
assert.equal(Object.isFrozen(cancelled[0]), true);
assert.equal(router.peekNext().sequence, 5);
assert.equal(router.route(user5).status, "duplicate");
assert.throws(
  () => router.route({ ...user5, payload: { text: "conflict" } }),
  RuntimeInputConflictError,
);

assert.throws(
  () => router.route({ ...input(6, "user.message", 500), conversationId: "other" }),
  RuntimeInputRejectedError,
);
assert.throws(
  () => router.applyStopFence(0),
  TypeError,
);

const limited = new InputRouter({
  conversationId: "conversation-router",
  turnCapacity: 1,
});
limited.route(input(10, "user.message", 500));
assert.throws(
  () => limited.route(input(11, "user.message", 500)),
  RuntimeInputQueueFullError,
);

const serializedLogs = JSON.stringify(logs);
for (const forbidden of [secret, "payload", "stack", "cause", "path"]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(logs.some((entry) => entry.event === "runtime.input.routed"), true);
assert.equal(logs.some((entry) => entry.event === "runtime.input.stop_fence_applied"), true);

console.log("runtime input router smoke passed");
