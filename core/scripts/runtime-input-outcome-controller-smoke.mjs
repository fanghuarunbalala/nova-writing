import assert from "node:assert/strict";
import {
  EXECUTION_CANCELLATION_REASON,
  OUTPUT_EVENT_TYPE,
  RUNTIME_INPUT_PROCESSING_FAILURE_CODE,
  RUNTIME_INPUT_PROCESSING_OUTCOME,
  RuntimeInputOutcomeConflictError,
  RuntimeInputOutcomeController,
  RuntimeInputOutcomeControllerStateError,
  RuntimeInputOutcomePendingCommitError,
  Sha256RuntimeEventIdFactory,
} from "../dist/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../dist/node/index.js";

class FakeSink {
  constructor(options = {}) {
    this.events = [];
    this.nextSequence = options.nextSequence ?? 30;
    this.nextStatus = options.nextStatus ?? "recorded";
    this.failure = options.failure;
  }

  async append(event) {
    this.events.push(event);
    if (this.failure) {
      const failure = this.failure;
      this.failure = undefined;
      throw failure;
    }
    return Object.freeze({
      status: this.nextStatus,
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.nextSequence++,
      recordedAt: "2026-08-01T11:00:01.000Z",
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
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const conversationId = "conversation-input-outcome";
const timestamp = "2026-08-01T11:00:00.000Z";
const eventIdFactory = new Sha256RuntimeEventIdFactory({
  hasher: new NodeSha256RuntimeEventIdHasher(),
});
const logs = [];
const sink = new FakeSink();
const controller = new RuntimeInputOutcomeController({
  conversationId,
  eventIdFactory,
  eventSink: sink,
  clock: { now: () => timestamp },
  logger: new CollectingLogger(logs),
});

const firstInput = { id: "input-outcome-1", eventType: "user.message", sequence: 11 };
const firstOptions = {
  inputEvent: firstInput,
  outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
  correlationId: "correlation-outcome",
  runId: "run-outcome-1",
};
const firstCommit = await controller.record(firstOptions);
const expectedFirstEventId = eventIdFactory.create({
  conversationId,
  eventType: OUTPUT_EVENT_TYPE.runtimeInputProcessed,
  scope: "input",
  inputEventId: firstInput.id,
  ordinal: 0,
});
assert.equal(firstCommit.receipt.eventId, expectedFirstEventId);
assert.equal(firstCommit.outcome, RUNTIME_INPUT_PROCESSING_OUTCOME.consumed);
assert.equal(sink.events[0].timestamp, timestamp);
assert.equal(sink.events[0].causationId, firstInput.id);
assert.equal(sink.events[0].runId, "run-outcome-1");
assert.equal(Object.isFrozen(firstCommit), true);
assert.equal(Object.isFrozen(firstCommit.inputEvent), true);
assert.equal(controller.hasCompleted(firstInput.id), true);

const reusedCommit = await controller.record({ ...firstOptions });
assert.equal(reusedCommit, firstCommit);
assert.equal(sink.events.length, 1);
await assert.rejects(
  () =>
    controller.record({
      inputEvent: firstInput,
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.failed,
      failureCode: RUNTIME_INPUT_PROCESSING_FAILURE_CODE.processingFailed,
    }),
  (error) => error instanceof RuntimeInputOutcomeConflictError,
);

const cancelledInput = {
  id: "input-outcome-cancelled",
  eventType: "context.compact",
  sequence: 12,
};
const cancelledCommit = await controller.record({
  inputEvent: cancelledInput,
  outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.cancelledBeforeRun,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
assert.equal(
  cancelledCommit.outcome,
  RUNTIME_INPUT_PROCESSING_OUTCOME.cancelledBeforeRun,
);
assert.equal(sink.events[1].payload.cancellationReason, EXECUTION_CANCELLATION_REASON.stop);

const duplicateSink = new FakeSink({ nextSequence: 50, nextStatus: "duplicate" });
const duplicateController = new RuntimeInputOutcomeController({
  conversationId,
  eventIdFactory,
  eventSink: duplicateSink,
  clock: { now: () => timestamp },
});
const failedInput = { id: "input-outcome-failed", eventType: "agent.task", sequence: 13 };
const failedCommit = await duplicateController.record({
  inputEvent: failedInput,
  outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.failed,
  failureCode: RUNTIME_INPUT_PROCESSING_FAILURE_CODE.unsupportedInput,
});
assert.equal(failedCommit.receipt.status, "duplicate");
assert.equal(
  duplicateSink.events[0].payload.failureCode,
  RUNTIME_INPUT_PROCESSING_FAILURE_CODE.unsupportedInput,
);

const rawFailure = new Error("FORBIDDEN_INPUT_OUTCOME_RAW_ERROR");
const retrySink = new FakeSink({ nextSequence: 70, failure: rawFailure });
const retryLogs = [];
const retryController = new RuntimeInputOutcomeController({
  conversationId,
  eventIdFactory,
  eventSink: retrySink,
  clock: { now: () => timestamp },
  logger: new CollectingLogger(retryLogs),
});
const retryInput = { id: "input-outcome-retry", eventType: "user.message", sequence: 14 };
await assert.rejects(
  () =>
    retryController.record({
      inputEvent: retryInput,
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
    }),
  (error) => error === rawFailure,
);
const pending = retryController.getPendingCommit();
assert.equal(pending.inputEvent.id, retryInput.id);
assert.equal(pending.outcome, RUNTIME_INPUT_PROCESSING_OUTCOME.consumed);
assert.equal(Object.isFrozen(pending), true);
const firstAttemptEvent = retrySink.events[0];
await assert.rejects(
  () =>
    retryController.record({
      inputEvent: { id: "input-outcome-blocked", eventType: "user.message", sequence: 15 },
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
    }),
  (error) => error instanceof RuntimeInputOutcomePendingCommitError,
);
const retryCommit = await retryController.retryPending();
assert.equal(retrySink.events[1], firstAttemptEvent);
assert.equal(retrySink.events[1].timestamp, timestamp);
assert.equal(retryCommit.receipt.sequence, 70);
assert.equal(retryController.getPendingCommit(), undefined);
await assert.rejects(
  () => retryController.retryPending(),
  (error) =>
    error instanceof RuntimeInputOutcomeControllerStateError &&
    error.reason === "no_pending_commit",
);

const concurrentSink = new FakeSink({ nextSequence: 90 });
const concurrentController = new RuntimeInputOutcomeController({
  conversationId,
  eventIdFactory,
  eventSink: concurrentSink,
  clock: { now: () => timestamp },
});
const concurrentInput = {
  id: "input-outcome-concurrent",
  eventType: "user.message",
  sequence: 16,
};
const [concurrentFirst, concurrentSecond] = await Promise.all([
  concurrentController.record({
    inputEvent: concurrentInput,
    outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
  }),
  concurrentController.record({
    inputEvent: concurrentInput,
    outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
  }),
]);
assert.equal(concurrentFirst, concurrentSecond);
assert.equal(concurrentSink.events.length, 1);

await assert.rejects(
  () =>
    controller.record({
      inputEvent: { id: "input-invalid-turn", eventType: "user.message", sequence: 17 },
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
      turnId: "turn-without-run",
    }),
  (error) =>
    error instanceof RuntimeInputOutcomeControllerStateError &&
    error.reason === "turn_without_run",
);
await assert.rejects(
  () =>
    controller.record({
      inputEvent: { id: "input-invalid-cancel", eventType: "user.message", sequence: 18 },
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.cancelledBeforeRun,
      cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
      runId: "run-invalid-cancel",
    }),
  (error) =>
    error instanceof RuntimeInputOutcomeControllerStateError &&
    error.reason === "cancelled_input_has_run",
);
await assert.rejects(
  () =>
    controller.record({
      inputEvent: { id: "input-invalid-payload", eventType: "user.message", sequence: 19 },
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
      cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
    }),
  TypeError,
);

const serializedLogs = JSON.stringify([...logs, ...retryLogs]);
for (const forbidden of [
  "FORBIDDEN_INPUT_OUTCOME_RAW_ERROR",
  "payload",
  "stack",
  "cause",
  "path",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(
  logs.some((entry) => entry.event === "runtime.input.outcome_commit_completed"),
  true,
);
assert.equal(logs.some((entry) => entry.event === "runtime.input.outcome_reused"), true);

console.log("runtime input outcome controller smoke passed");
