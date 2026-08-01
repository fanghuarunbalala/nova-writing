import assert from "node:assert/strict";
import {
  EXECUTION_CANCELLATION_REASON,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
  TurnControllerPendingCommitError,
  TurnControllerStateError,
} from "../dist/index.js";

class FixedIdFactory {
  inputs = [];
  create(input) {
    this.inputs.push(input);
    return `evt-controller-${input.scope}-${input.ordinal}-${input.scope === "turn" ? input.turnId : input.runId}`;
  }
}

class IncrementingClock {
  offset = 0;
  now() {
    const value = new Date(Date.UTC(2026, 7, 1, 8, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class FakeSink {
  events = [];
  failures = [];
  async append(event) {
    this.events.push(event);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return Object.freeze({
      status: this.events.length === 1 ? "recorded" : "duplicate",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: "2026-08-01T08:30:00.000Z",
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

const sink = new FakeSink();
const idFactory = new FixedIdFactory();
const logs = [];
const controller = new TurnController({
  conversationId: "conversation-controller",
  eventIdFactory: idFactory,
  eventSink: sink,
  runIdGenerator: { generate: () => "run-controller-1" },
  turnIdGenerator: { generate: () => "turn-controller-1" },
  clock: new IncrementingClock(),
  logger: new CollectingLogger(logs),
});

const queued = await controller.beginRun({
  inputEvent: { id: "input-controller-1", eventType: "user.message", sequence: 51 },
  correlationId: "correlation-controller-1",
});
assert.equal(queued.transition.current, "queued");
assert.equal(controller.getRunSnapshot().status, "queued");
assert.equal(sink.events[0].causationId, "input-controller-1");
assert.equal(idFactory.inputs[0].ordinal, 0);

await controller.transitionRun({
  current: RUN_STATUS.running,
  reason: RUN_STATE_CHANGE_REASON.executionStarted,
});
await controller.beginTurn();
assert.equal(controller.getTurnSnapshot().status, "running");
await assert.rejects(
  () => controller.transitionRun({
    current: RUN_STATUS.completed,
    reason: RUN_STATE_CHANGE_REASON.executionCompleted,
  }),
  TurnControllerStateError,
);
await controller.transitionTurn({
  current: TURN_STATUS.completed,
  reason: TURN_STATE_CHANGE_REASON.turnCompleted,
});
await controller.transitionRun({
  current: RUN_STATUS.completed,
  reason: RUN_STATE_CHANGE_REASON.executionCompleted,
});
assert.equal(controller.getRunSnapshot().status, "completed");

const failingSink = new FakeSink();
failingSink.failures.push(new Error("FORBIDDEN_CONTROLLER_RAW_ERROR"));
const retryController = new TurnController({
  conversationId: "conversation-controller-retry",
  eventIdFactory: new FixedIdFactory(),
  eventSink: failingSink,
  runIdGenerator: { generate: () => "run-controller-retry" },
  clock: new IncrementingClock(),
});
await assert.rejects(() => retryController.beginRun({
  inputEvent: { id: "input-controller-retry", eventType: "user.message", sequence: 52 },
}));
assert.equal(retryController.getRunSnapshot(), undefined);
const pending = retryController.getPendingCommit();
assert.equal(pending.scope, "run");
await assert.rejects(
  () => retryController.beginRun({
    inputEvent: { id: "input-controller-blocked", eventType: "user.message", sequence: 53 },
  }),
  TurnControllerPendingCommitError,
);
const originalEvent = failingSink.events[0];
await retryController.retryPending();
assert.equal(failingSink.events[1], originalEvent);
assert.equal(retryController.getPendingCommit(), undefined);
assert.equal(retryController.getRunSnapshot().status, "queued");

const cancelSink = new FakeSink();
const cancelController = new TurnController({
  conversationId: "conversation-controller-cancel",
  eventIdFactory: new FixedIdFactory(),
  eventSink: cancelSink,
  runIdGenerator: { generate: () => "run-controller-cancel" },
  turnIdGenerator: { generate: () => "turn-controller-cancel" },
  clock: new IncrementingClock(),
});
await cancelController.beginRun({
  inputEvent: { id: "input-controller-cancel", eventType: "user.message", sequence: 54 },
});
await cancelController.transitionRun({ current: RUN_STATUS.running, reason: RUN_STATE_CHANGE_REASON.executionStarted });
await cancelController.beginTurn();
await assert.rejects(
  () => cancelController.transitionRun({ current: RUN_STATUS.stopping, reason: RUN_STATE_CHANGE_REASON.stopRequested }),
  TurnControllerStateError,
);
await cancelController.transitionTurn({ current: TURN_STATUS.stopping, reason: TURN_STATE_CHANGE_REASON.stopRequested });
await cancelController.transitionRun({ current: RUN_STATUS.stopping, reason: RUN_STATE_CHANGE_REASON.stopRequested });
await cancelController.transitionTurn({
  current: TURN_STATUS.cancelled,
  reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
await cancelController.transitionRun({
  current: RUN_STATUS.cancelled,
  reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
assert.equal(cancelController.getRunSnapshot().cancellationReason, "stop");

await assert.rejects(
  () => new TurnController({
    conversationId: "conversation-restore",
    eventIdFactory: new FixedIdFactory(),
    eventSink: new FakeSink(),
  }).restore({
    run: {
      runId: "run-restore",
      inputEvent: { id: "input-restore", eventType: "user.message", sequence: 55 },
      status: RUN_STATUS.completed,
      reason: RUN_STATE_CHANGE_REASON.executionCompleted,
      transitionOrdinal: 2,
    },
    turn: {
      runId: "run-other",
      turnId: "turn-restore",
      status: TURN_STATUS.completed,
      reason: TURN_STATE_CHANGE_REASON.turnCompleted,
      transitionOrdinal: 1,
    },
  }),
  TurnControllerStateError,
);

const serializedLogs = JSON.stringify(logs);
for (const forbidden of ["payload", "stack", "cause", "path", "FORBIDDEN_CONTROLLER_RAW_ERROR"]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(logs.some((entry) => entry.event === "turn_controller.commit_completed"), true);

console.log("turn controller smoke passed");
