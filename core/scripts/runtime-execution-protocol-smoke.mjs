import assert from "node:assert/strict";
import {
  AgentRunStateChangedOutputEvent,
  AgentTurnStateChangedOutputEvent,
  createCoreEventSchemaRegistry,
  EventValidationError,
  EXECUTION_CANCELLATION_REASON,
  OUTPUT_EVENT_TYPE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RUNTIME_INPUT_PROCESSING_FAILURE_CODE,
  RUNTIME_INPUT_PROCESSING_OUTCOME,
  RuntimeInputProcessedOutputEvent,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
} from "../dist/index.js";

const registry = createCoreEventSchemaRegistry();
const inputEvent = {
  id: "input-runtime-protocol-1",
  eventType: "user.message",
  sequence: 21,
};

const runEvent = new AgentRunStateChangedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-run-protocol-1",
  timestamp: "2026-08-01T05:00:00.000Z",
  runId: "run-runtime-protocol-1",
  inputEvent,
  previous: null,
  current: RUN_STATUS.queued,
  reason: RUN_STATE_CHANGE_REASON.inputQueued,
  correlationId: "correlation-runtime-protocol-1",
  causationId: inputEvent.id,
});
inputEvent.id = "mutated-input";
inputEvent.sequence = 999;

const runSnapshot = runEvent.getSnapshot();
assert.deepEqual(runSnapshot, {
  id: "output-run-protocol-1",
  conversationId: "conversation-runtime-protocol",
  eventType: OUTPUT_EVENT_TYPE.agentRunStateChanged,
  schemaVersion: 1,
  timestamp: "2026-08-01T05:00:00.000Z",
  correlationId: "correlation-runtime-protocol-1",
  causationId: "input-runtime-protocol-1",
  runId: "run-runtime-protocol-1",
  payload: {
    inputEvent: {
      id: "input-runtime-protocol-1",
      eventType: "user.message",
      sequence: 21,
    },
    previous: null,
    current: "queued",
    reason: "input_queued",
  },
});
assert.deepEqual(registry.validateOutput(runSnapshot), runSnapshot);
assert.equal(Object.isFrozen(runEvent.getPayload().inputEvent), true);
runSnapshot.payload.inputEvent.id = "mutated-snapshot";
assert.equal(runEvent.getSnapshot().payload.inputEvent.id, "input-runtime-protocol-1");

const turnEvent = new AgentTurnStateChangedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-turn-protocol-1",
  timestamp: "2026-08-01T05:00:01.000Z",
  runId: "run-runtime-protocol-1",
  turnId: "turn-runtime-protocol-1",
  previous: TURN_STATUS.running,
  current: TURN_STATUS.completed,
  reason: TURN_STATE_CHANGE_REASON.turnCompleted,
});
const turnSnapshot = turnEvent.getSnapshot();
assert.deepEqual(turnSnapshot, {
  id: "output-turn-protocol-1",
  conversationId: "conversation-runtime-protocol",
  eventType: OUTPUT_EVENT_TYPE.agentTurnStateChanged,
  schemaVersion: 1,
  timestamp: "2026-08-01T05:00:01.000Z",
  runId: "run-runtime-protocol-1",
  turnId: "turn-runtime-protocol-1",
  payload: {
    previous: "running",
    current: "completed",
    reason: "turn_completed",
  },
});
assert.deepEqual(registry.validateOutput(turnSnapshot), turnSnapshot);

const cancelledRunSnapshot = new AgentRunStateChangedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-run-protocol-cancelled",
  timestamp: "2026-08-01T05:00:02.000Z",
  runId: "run-runtime-protocol-2",
  inputEvent: {
    id: "input-runtime-protocol-2",
    eventType: "user.message",
    sequence: 22,
  },
  previous: RUN_STATUS.stopping,
  current: RUN_STATUS.cancelled,
  reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
}).getSnapshot();
assert.equal(cancelledRunSnapshot.payload.cancellationReason, "stop");
assert.deepEqual(registry.validateOutput(cancelledRunSnapshot), cancelledRunSnapshot);

const cancelledTurnSnapshot = new AgentTurnStateChangedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-turn-protocol-cancelled",
  timestamp: "2026-08-01T05:00:03.000Z",
  runId: "run-runtime-protocol-2",
  turnId: "turn-runtime-protocol-2",
  previous: TURN_STATUS.stopping,
  current: TURN_STATUS.cancelled,
  reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.parentStop,
}).getSnapshot();
assert.equal(cancelledTurnSnapshot.payload.cancellationReason, "parent_stop");
assert.deepEqual(registry.validateOutput(cancelledTurnSnapshot), cancelledTurnSnapshot);

const processedInput = {
  id: "input-runtime-protocol-4",
  eventType: "user.message",
  sequence: 24,
};
const consumedInputEvent = new RuntimeInputProcessedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-input-processed-1",
  timestamp: "2026-08-01T05:00:04.000Z",
  inputEvent: processedInput,
  outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
  runId: "run-runtime-protocol-3",
});
processedInput.id = "mutated-processed-input";
processedInput.sequence = 1000;
const consumedInputSnapshot = consumedInputEvent.getSnapshot();
assert.deepEqual(consumedInputSnapshot, {
  id: "output-input-processed-1",
  conversationId: "conversation-runtime-protocol",
  eventType: OUTPUT_EVENT_TYPE.runtimeInputProcessed,
  schemaVersion: 1,
  timestamp: "2026-08-01T05:00:04.000Z",
  causationId: "input-runtime-protocol-4",
  runId: "run-runtime-protocol-3",
  payload: {
    outcome: "consumed",
  },
  inputEvent: {
    id: "input-runtime-protocol-4",
    eventType: "user.message",
    sequence: 24,
  },
});
assert.deepEqual(registry.validateOutput(consumedInputSnapshot), consumedInputSnapshot);
assert.equal(Object.isFrozen(consumedInputEvent.inputEvent), true);

const cancelledInputSnapshot = new RuntimeInputProcessedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-input-processed-2",
  timestamp: "2026-08-01T05:00:05.000Z",
  inputEvent: {
    id: "input-runtime-protocol-5",
    eventType: "user.message",
    sequence: 25,
  },
  outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.cancelledBeforeRun,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
}).getSnapshot();
assert.deepEqual(cancelledInputSnapshot.payload, {
  outcome: "cancelled_before_run",
  cancellationReason: "stop",
});
assert.deepEqual(registry.validateOutput(cancelledInputSnapshot), cancelledInputSnapshot);

const failedInputSnapshot = new RuntimeInputProcessedOutputEvent({
  conversationId: "conversation-runtime-protocol",
  id: "output-input-processed-3",
  timestamp: "2026-08-01T05:00:06.000Z",
  inputEvent: {
    id: "input-runtime-protocol-6",
    eventType: "extension.unknown",
    sequence: 26,
  },
  outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.failed,
  failureCode: RUNTIME_INPUT_PROCESSING_FAILURE_CODE.unsupportedInput,
}).getSnapshot();
assert.deepEqual(failedInputSnapshot.payload, {
  outcome: "failed",
  failureCode: "unsupported_input",
});
assert.deepEqual(registry.validateOutput(failedInputSnapshot), failedInputSnapshot);

assert.throws(
  () =>
    new AgentRunStateChangedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      runId: " ",
      inputEvent: {
        id: "input-runtime-protocol-2",
        eventType: "user.message",
        sequence: 22,
      },
      previous: null,
      current: RUN_STATUS.running,
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    }),
  TypeError,
);
assert.throws(
  () =>
    new AgentRunStateChangedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      runId: "run-runtime-protocol-cancelled-without-reason",
      inputEvent: {
        id: "input-runtime-protocol-7",
        eventType: "user.message",
        sequence: 27,
      },
      previous: RUN_STATUS.stopping,
      current: RUN_STATUS.cancelled,
      reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
    }),
  TypeError,
);
assert.throws(
  () =>
    new AgentTurnStateChangedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      runId: "run-runtime-protocol-4",
      turnId: "turn-runtime-protocol-4",
      previous: TURN_STATUS.running,
      current: TURN_STATUS.completed,
      reason: TURN_STATE_CHANGE_REASON.turnCompleted,
      cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
    }),
  TypeError,
);
assert.throws(
  () =>
    new RuntimeInputProcessedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      inputEvent: {
        id: "input-runtime-protocol-8",
        eventType: "user.message",
        sequence: 28,
      },
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.cancelledBeforeRun,
    }),
  TypeError,
);
assert.throws(
  () =>
    new RuntimeInputProcessedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      inputEvent: {
        id: "input-runtime-protocol-9",
        eventType: "user.message",
        sequence: 29,
      },
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
      cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
    }),
  TypeError,
);
assert.throws(
  () =>
    new AgentTurnStateChangedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      runId: "run-runtime-protocol-1",
      turnId: "",
      previous: null,
      current: TURN_STATUS.running,
      reason: TURN_STATE_CHANGE_REASON.providerStarted,
    }),
  TypeError,
);
assert.throws(
  () =>
    new AgentRunStateChangedOutputEvent({
      conversationId: "conversation-runtime-protocol",
      runId: "run-runtime-protocol-2",
      inputEvent: {
        id: "input-runtime-protocol-3",
        eventType: "user.message",
        sequence: 23,
      },
      previous: null,
      current: "unknown",
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    }),
  TypeError,
);

for (const invalidSnapshot of [
  { ...runEvent.getSnapshot(), runId: undefined },
  { ...turnSnapshot, turnId: undefined },
  {
    ...runEvent.getSnapshot(),
    payload: { ...runEvent.getSnapshot().payload, reason: "unknown_reason" },
  },
  {
    ...turnSnapshot,
    payload: { ...turnSnapshot.payload, current: "waiting_provider" },
  },
  {
    ...cancelledRunSnapshot,
    payload: {
      ...cancelledRunSnapshot.payload,
      cancellationReason: undefined,
    },
  },
  {
    ...consumedInputSnapshot,
    payload: {
      outcome: "consumed",
      cancellationReason: "stop",
    },
  },
  {
    ...failedInputSnapshot,
    payload: {
      outcome: "failed",
      failureCode: "raw_error_message",
    },
  },
]) {
  assert.throws(() => registry.validateOutput(invalidSnapshot), EventValidationError);
}

assert.throws(
  () =>
    registry.validateOutput({
      id: "output-host-without-reference",
      conversationId: "conversation-runtime-protocol",
      eventType: OUTPUT_EVENT_TYPE.hostInputRouted,
      schemaVersion: 1,
      timestamp: "2026-08-01T05:00:02.000Z",
      payload: {
        handler: "stop",
        outcome: "runtime_notified",
      },
    }),
  EventValidationError,
);

for (const forbidden of ["provider", "model", "piEvent", "runtimeInstanceId", "pid"]) {
  assert.equal(JSON.stringify([runEvent.getSnapshot(), turnSnapshot]).includes(forbidden), false);
}

console.log("runtime execution protocol smoke passed");
