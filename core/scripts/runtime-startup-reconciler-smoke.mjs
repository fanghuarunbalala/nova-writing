import assert from "node:assert/strict";
import {
  RUNTIME_STARTUP_LIFECYCLE_DISPOSITION,
  RUNTIME_STARTUP_RECONCILIATION_FAILURE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RuntimeStartupReconciler,
  RuntimeStartupReconciliationError,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
} from "../dist/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const conversationId = "conversation-startup";
const timestamp = "2026-08-01T12:00:00.000Z";
const recordedAt = "2026-08-01T12:00:01.000Z";
const secret = "FORBIDDEN_STARTUP_NOVEL_TEXT";

function input(id, eventType, sequence, payload, correlationId) {
  return Object.freeze({
    id,
    conversationId,
    eventType,
    schemaVersion: 1,
    priority: eventType === "system.stop" ? 1000 : 500,
    timestamp,
    ...(correlationId !== undefined ? { correlationId } : {}),
    payload: Object.freeze(payload),
    direction: "input",
    sequence,
    recordedAt,
  });
}

const stopInput = input("input-startup-stop", "system.stop", 8, {});
const claimedInput = input(
  "input-startup-run",
  "user.message",
  10,
  { text: secret },
  "correlation-startup",
);
const claimedReference = {
  id: claimedInput.id,
  eventType: claimedInput.eventType,
  sequence: claimedInput.sequence,
};
const terminalRun = Object.freeze({
  runId: "run-startup",
  inputEvent: Object.freeze(claimedReference),
  status: RUN_STATUS.completed,
  reason: RUN_STATE_CHANGE_REASON.executionCompleted,
  transitionOrdinal: 2,
});
const terminalTurn = Object.freeze({
  runId: terminalRun.runId,
  turnId: "turn-startup",
  status: TURN_STATUS.completed,
  reason: TURN_STATE_CHANGE_REASON.turnCompleted,
  transitionOrdinal: 1,
});
const baseReplay = {
  conversationId,
  throughSequence: 15,
  scannedEventCount: 15,
  processedInputCount: 1,
  pendingInputs: Object.freeze([stopInput, claimedInput]),
  unconfirmedRunInputs: Object.freeze([
    Object.freeze({ inputEvent: Object.freeze(claimedReference), runId: terminalRun.runId }),
  ]),
};

const logs = [];
const reconciler = new RuntimeStartupReconciler({
  logger: new CollectingLogger(logs),
});
const ready = reconciler.reconcile({
  ...baseReplay,
  run: terminalRun,
  turn: terminalTurn,
});
assert.equal(ready.lifecycleDisposition, RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready);
assert.deepEqual(ready.outcomeRepairs, [
  {
    inputEvent: claimedReference,
    outcome: "consumed",
    runId: terminalRun.runId,
    correlationId: "correlation-startup",
  },
]);
assert.deepEqual(ready.routableInputs.map((candidate) => candidate.id), [stopInput.id]);
assert.equal(Object.isFrozen(ready), true);
assert.equal(Object.isFrozen(ready.outcomeRepairs), true);
assert.equal(Object.isFrozen(ready.routableInputs), true);
assert.equal(Object.isFrozen(ready.outcomeRepairs[0]), true);
assert.equal(Object.isFrozen(ready.outcomeRepairs[0].inputEvent), true);

const activeRun = Object.freeze({
  ...terminalRun,
  status: RUN_STATUS.running,
  reason: RUN_STATE_CHANGE_REASON.executionStarted,
  transitionOrdinal: 1,
});
const activeTurn = Object.freeze({
  ...terminalTurn,
  status: TURN_STATUS.running,
  reason: TURN_STATE_CHANGE_REASON.providerStarted,
  transitionOrdinal: 0,
});
const blocked = reconciler.reconcile({
  ...baseReplay,
  run: activeRun,
  turn: activeTurn,
});
assert.equal(
  blocked.lifecycleDisposition,
  RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.recoveryRequired,
);
assert.equal(blocked.outcomeRepairs.length, 1);
assert.equal(blocked.routableInputs.length, 1);

const idleInput = input("input-startup-idle", "user.message", 1, { text: "idle" });
const idle = reconciler.reconcile({
  conversationId,
  throughSequence: 1,
  scannedEventCount: 1,
  processedInputCount: 0,
  pendingInputs: Object.freeze([idleInput]),
  unconfirmedRunInputs: Object.freeze([]),
});
assert.equal(idle.lifecycleDisposition, RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.ready);
assert.equal(idle.outcomeRepairs.length, 0);
assert.deepEqual(idle.routableInputs.map((candidate) => candidate.id), [idleInput.id]);

function expectFailure(replay, failure) {
  assert.throws(
    () => reconciler.reconcile(replay),
    (error) =>
      error instanceof RuntimeStartupReconciliationError && error.failure === failure,
  );
}

expectFailure(
  {
    ...baseReplay,
    unconfirmedRunInputs: Object.freeze([
      Object.freeze({
        inputEvent: Object.freeze({ ...claimedReference, sequence: 9 }),
        runId: terminalRun.runId,
      }),
    ]),
    run: terminalRun,
    turn: terminalTurn,
  },
  RUNTIME_STARTUP_RECONCILIATION_FAILURE.claimMismatch,
);
expectFailure(
  {
    conversationId,
    throughSequence: 1,
    scannedEventCount: 1,
    processedInputCount: 0,
    pendingInputs: Object.freeze([idleInput]),
    unconfirmedRunInputs: Object.freeze([]),
    turn: activeTurn,
  },
  RUNTIME_STARTUP_RECONCILIATION_FAILURE.lifecycleConflict,
);
expectFailure(
  {
    conversationId,
    throughSequence: 10,
    scannedEventCount: 2,
    processedInputCount: 0,
    pendingInputs: Object.freeze([claimedInput, stopInput]),
    unconfirmedRunInputs: Object.freeze([]),
  },
  RUNTIME_STARTUP_RECONCILIATION_FAILURE.invalidPlan,
);

const serializedLogs = JSON.stringify(logs);
for (const forbidden of [secret, "payload", "stack", "cause", "path", "workdir"]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(logs.some((entry) => entry.event === "runtime.startup.reconciled"), true);
assert.equal(logs.some((entry) => entry.event === "runtime.startup.reconcile_failed"), true);

console.log("runtime startup reconciler smoke passed");
