import assert from "node:assert/strict";
import {
  NUDGE_DELIVERY,
  NUDGE_STATE_ACTION,
  NUDGE_STATE_MACHINE_FAILURE,
  NudgeStateMachine,
  NudgeStateMachineError,
  capturePendingNudge,
} from "../dist/index.js";

const machine = new NudgeStateMachine();
const base = capturePendingNudge({
  id: "nudge-once",
  policyId: "policy.test",
  templateId: "template.test",
  templateVersion: "1.0.0",
  priority: 10,
  dedupeKey: "once",
  parameters: { value: true },
  exclusive: false,
  placement: "system-prompt-overlay",
  delivery: NUDGE_DELIVERY.once,
  state: "scheduled",
  targetRunId: "run-1",
  scheduledSequence: 1,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});

const leased = machine.transition(base, NUDGE_STATE_ACTION.lease);
assert.equal(leased.state, "leased");
const released = machine.transition(leased, NUDGE_STATE_ACTION.release);
assert.equal(released.state, "scheduled");
const applied = machine.transition(
  machine.transition(base, NUDGE_STATE_ACTION.lease),
  NUDGE_STATE_ACTION.dispatchConfirmed,
);
assert.equal(applied.state, "applied");
const consumed = machine.transition(applied, NUDGE_STATE_ACTION.consume);
assert.equal(consumed.state, "consumed");
assert.deepEqual(
  machine.transition(consumed, NUDGE_STATE_ACTION.consume),
  consumed,
);
assert.ok(Object.isFrozen(consumed));

const persistent = capturePendingNudge({
  ...base,
  id: "nudge-ack",
  delivery: NUDGE_DELIVERY.untilAcknowledged,
  acknowledgementRef: { id: "ack.test", version: "1.0.0" },
});
const active = machine.transition(
  machine.transition(
    machine.transition(persistent, NUDGE_STATE_ACTION.lease),
    NUDGE_STATE_ACTION.dispatchConfirmed,
  ),
  NUDGE_STATE_ACTION.activate,
);
assert.equal(active.state, "active");
const acknowledged = machine.transition(active, NUDGE_STATE_ACTION.acknowledge);
assert.equal(acknowledged.state, "acknowledged");
assert.deepEqual(
  machine.transition(acknowledged, NUDGE_STATE_ACTION.acknowledge),
  acknowledged,
);

const conditional = capturePendingNudge({
  ...base,
  id: "nudge-condition",
  delivery: NUDGE_DELIVERY.untilCondition,
  conditionRef: { id: "condition.test", version: "1.0.0" },
});
const conditionalActive = machine.transition(
  machine.transition(
    machine.transition(conditional, NUDGE_STATE_ACTION.lease),
    NUDGE_STATE_ACTION.dispatchConfirmed,
  ),
  NUDGE_STATE_ACTION.activate,
);
assert.equal(
  machine.transition(conditionalActive, NUDGE_STATE_ACTION.resolve).state,
  "resolved",
);

assert.throws(
  () => machine.transition(base, NUDGE_STATE_ACTION.consume),
  (error) => error instanceof NudgeStateMachineError &&
    error.failure === NUDGE_STATE_MACHINE_FAILURE.illegalTransition,
);
assert.throws(
  () => machine.transition(applied, NUDGE_STATE_ACTION.activate),
  (error) => error instanceof NudgeStateMachineError &&
    error.failure === NUDGE_STATE_MACHINE_FAILURE.illegalTransition,
);
assert.throws(
  () => machine.transition(active, NUDGE_STATE_ACTION.resolve),
  (error) => error instanceof NudgeStateMachineError &&
    error.failure === NUDGE_STATE_MACHINE_FAILURE.illegalTransition,
);
assert.throws(
  () => machine.transition(base, "unknown"),
  (error) => error instanceof NudgeStateMachineError &&
    error.failure === NUDGE_STATE_MACHINE_FAILURE.invalidAction,
);

console.log("runtime nudge state machine smoke: passed");
