import assert from "node:assert/strict";
import {
  ApprovalDecisionInputEvent,
  InMemoryInteractionCoordinator,
  InteractionCoordinatorError,
  TOOL_APPROVAL_DECISION_OUTCOME,
  projectToolApprovalInteractionSnapshot,
} from "../dist/index.js";

class CollectingSink {
  constructor() { this.events = []; }
  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: event.timestamp,
    });
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) { this.entries.push({ level, event, fields: { ...this.bindings, ...fields } }); }
}

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const sink = new CollectingSink();
const logs = [];
const coordinator = new InMemoryInteractionCoordinator({
  eventSink: sink,
  logger: new CollectingLogger(logs),
});
const requestA = approvalRequest("approval-a", "tool-call-a", digestA, 1, 6);
const requestB = approvalRequest("approval-b", "tool-call-b", digestB, 2, 7);
const promiseA = coordinator.request(requestA);
const promiseB = coordinator.request(requestB);
assert.deepEqual((await coordinator.listPending()).map((request) => request.approvalRequestId), [
  "approval-a",
  "approval-b",
]);
assert.equal(sink.events.length, 2);

const wrongDigest = persistedDecision("input-wrong", "approval-a", digestB, "approved", 10);
assert.equal((await coordinator.resolve(wrongDigest, { actorId: "local_user" })).outcome,
  TOOL_APPROVAL_DECISION_OUTCOME.identityMismatch);
assert.equal((await coordinator.listPending()).length, 2);

const decisionA = persistedDecision("input-a", "approval-a", digestA, "approved", 11);
const [first, second] = await Promise.all([
  coordinator.resolve(decisionA, { actorId: "local_user" }),
  coordinator.resolve(decisionA, { actorId: "other_local_user" }),
]);
assert.equal(first.outcome, TOOL_APPROVAL_DECISION_OUTCOME.resolved);
assert.equal(second.outcome, TOOL_APPROVAL_DECISION_OUTCOME.duplicate);
assert.equal((await promiseA).actorId, "local_user");

await assert.rejects(
  coordinator.resolve(
    persistedDecision("input-b-invalid", "approval-b", digestB, "rejected", 12),
    { actorId: "" },
  ),
  InteractionCoordinatorError,
);
assert.equal((await coordinator.listPending()).length, 1);
const rejection = await coordinator.resolve(
  persistedDecision("input-b", "approval-b", digestB, "rejected", 13),
  { actorId: "local_user" },
);
assert.equal(rejection.outcome, TOOL_APPROVAL_DECISION_OUTCOME.resolved);
assert.equal((await promiseB).decision, "rejected");

const requestC = approvalRequest("approval-c", "tool-call-c", digestA, 3, 4);
const promiseC = coordinator.request(requestC);
await coordinator.listPending();
const expired = await coordinator.expire("2026-08-02T01:04:30.000Z");
assert.deepEqual(expired.map((resolution) => resolution.approvalRequestId), ["approval-c"]);
assert.equal((await promiseC).decision, "expired");

const requestD = approvalRequest("approval-d", "tool-call-d", digestB, 5, 9);
const promiseD = coordinator.request(requestD);
await coordinator.listPending();
assert.equal((await coordinator.cancel("approval-d", "2026-08-02T01:05:30.000Z")).outcome,
  TOOL_APPROVAL_DECISION_OUTCOME.resolved);
assert.equal((await promiseD).decision, "cancelled");

const projectedEvents = sink.events.map((event, index) => ({
  ...event.getSnapshot(),
  direction: "output",
  sequence: index + 1,
  recordedAt: event.timestamp,
}));
const projected = projectToolApprovalInteractionSnapshot(projectedEvents);
assert.equal(projected.pending.length, 0);
assert.equal(projected.resolved.length, 4);

const restoreSink = new CollectingSink();
const restored = new InMemoryInteractionCoordinator({ eventSink: restoreSink });
const pendingRequest = approvalRequest("approval-restored", "tool-call-restored", digestA, 6, 10);
await restored.restore({ schemaVersion: 1, pending: [pendingRequest], resolved: [] });
const restoredWait = restored.wait("approval-restored");
await restored.resolve(
  persistedDecision("input-restored", "approval-restored", digestA, "approved", 20),
  { actorId: "local_user" },
);
assert.equal((await restoredWait).decision, "approved");
assert.equal(restoreSink.events.length, 1);

const serializedEvents = JSON.stringify(sink.events.map((event) => event.getSnapshot()));
const serializedLogs = JSON.stringify(logs);
for (const forbidden of ["raw_arguments", "secret-path", "stack", "cause"]) {
  assert.equal(serializedEvents.includes(forbidden), false);
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(serializedLogs.includes("payload"), false);
console.log("tool interaction coordinator smoke passed");

function approvalRequest(approvalRequestId, toolCallId, argumentDigest, minute, expiryMinute) {
  return {
    approvalRequestId,
    identity: {
      conversationId: "conversation-approval",
      runId: "run-approval",
      toolCallId,
      toolName: "WriteFile",
      toolVersion: "1.0.0",
      argumentDigest,
    },
    turnId: "turn-approval",
    summary: { title: "Modify the current draft" },
    requestedAt: `2026-08-02T01:${String(minute).padStart(2, "0")}:00.000Z`,
    expiresAt: `2026-08-02T01:${String(expiryMinute).padStart(2, "0")}:00.000Z`,
  };
}

function persistedDecision(id, approvalRequestId, argumentDigest, decision, sequence) {
  const event = new ApprovalDecisionInputEvent({
    id,
    conversationId: "conversation-approval",
    runId: "run-approval",
    turnId: "turn-approval",
    timestamp: `2026-08-02T01:10:${String(sequence).padStart(2, "0")}.000Z`,
    approvalRequestId,
    decision,
    argumentDigest,
  });
  return {
    ...event.getSnapshot(),
    direction: "input",
    sequence,
    recordedAt: event.timestamp,
  };
}
