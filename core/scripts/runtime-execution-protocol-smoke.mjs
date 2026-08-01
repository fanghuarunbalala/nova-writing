import assert from "node:assert/strict";
import {
  AgentRunStateChangedOutputEvent,
  AgentTurnStateChangedOutputEvent,
  createCoreEventSchemaRegistry,
  EventValidationError,
  OUTPUT_EVENT_TYPE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
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
