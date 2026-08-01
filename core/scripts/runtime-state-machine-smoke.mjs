import assert from "node:assert/strict";
import {
  EXECUTION_CANCELLATION_REASON,
  ExecutionStateRestoreError,
  ExecutionStateTransitionError,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RunStateMachine,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnStateMachine,
} from "../dist/index.js";

const inputEvent = { id: "input-state-1", eventType: "user.message", sequence: 41 };
const run = new RunStateMachine();
assert.equal(run.getSnapshot(), undefined);
assert.equal(run.hasActiveRun(), false);
const queued = run.begin({ runId: "run-state-1", inputEvent });
inputEvent.id = "mutated";
assert.deepEqual(queued, {
  runId: "run-state-1",
  inputEvent: { id: "input-state-1", eventType: "user.message", sequence: 41 },
  previous: null,
  current: "queued",
  reason: "input_queued",
  ordinal: 0,
});
assert.equal(Object.isFrozen(queued), true);
assert.equal(Object.isFrozen(queued.inputEvent), true);
assert.equal(run.hasActiveRun(), true);
assert.throws(
  () => run.begin({ runId: "run-state-duplicate", inputEvent: queued.inputEvent }),
  ExecutionStateTransitionError,
);

const running = run.transition({
  current: RUN_STATUS.running,
  reason: RUN_STATE_CHANGE_REASON.executionStarted,
});
assert.equal(running.ordinal, 1);
const completed = run.transition({
  current: RUN_STATUS.completed,
  reason: RUN_STATE_CHANGE_REASON.executionCompleted,
});
assert.equal(completed.ordinal, 2);
assert.equal(run.hasActiveRun(), false);
assert.throws(
  () =>
    run.transition({
      current: RUN_STATUS.running,
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    }),
  ExecutionStateTransitionError,
);

const secondQueued = run.begin({
  runId: "run-state-2",
  inputEvent: { id: "input-state-2", eventType: "user.message", sequence: 42 },
});
assert.equal(secondQueued.ordinal, 0);
run.transition({
  current: RUN_STATUS.stopping,
  reason: RUN_STATE_CHANGE_REASON.stopRequested,
});
const cancelledRun = run.transition({
  current: RUN_STATUS.cancelled,
  reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
assert.equal(cancelledRun.cancellationReason, "stop");
assert.throws(
  () =>
    new RunStateMachine().restore({
      ...run.getSnapshot(),
      cancellationReason: undefined,
    }),
  ExecutionStateRestoreError,
);

const restoredRun = new RunStateMachine();
restoredRun.restore({
  runId: "run-restored",
  inputEvent: { id: "input-restored", eventType: "user.message", sequence: 43 },
  status: RUN_STATUS.running,
  reason: RUN_STATE_CHANGE_REASON.executionStarted,
  transitionOrdinal: 4,
});
assert.equal(restoredRun.getSnapshot().transitionOrdinal, 4);
assert.equal(
  restoredRun.transition({
    current: RUN_STATUS.failed,
    reason: RUN_STATE_CHANGE_REASON.executionFailed,
  }).ordinal,
  5,
);

const turn = new TurnStateMachine();
const turnStarted = turn.begin({ runId: "run-turn-1", turnId: "turn-state-1" });
assert.equal(turnStarted.ordinal, 0);
turn.transition({
  current: TURN_STATUS.waitingTool,
  reason: TURN_STATE_CHANGE_REASON.toolExecutionStarted,
});
turn.transition({
  current: TURN_STATUS.running,
  reason: TURN_STATE_CHANGE_REASON.toolExecutionCompleted,
});
const turnCompleted = turn.transition({
  current: TURN_STATUS.completed,
  reason: TURN_STATE_CHANGE_REASON.turnCompleted,
});
assert.equal(turnCompleted.ordinal, 3);
assert.equal(turn.hasActiveTurn(), false);

turn.begin({ runId: "run-turn-1", turnId: "turn-state-2" });
turn.transition({
  current: TURN_STATUS.stopping,
  reason: TURN_STATE_CHANGE_REASON.interruptRequested,
});
const interrupted = turn.transition({
  current: TURN_STATUS.cancelled,
  reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.interrupt,
});
assert.equal(interrupted.cancellationReason, "interrupt");
assert.throws(
  () =>
    turn.transition({
      current: TURN_STATUS.running,
      reason: TURN_STATE_CHANGE_REASON.providerStarted,
    }),
  ExecutionStateTransitionError,
);
assert.throws(
  () =>
    new TurnStateMachine().restore({
      runId: "run-invalid",
      turnId: "turn-invalid",
      status: TURN_STATUS.cancelled,
      reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
      transitionOrdinal: -1,
    }),
  ExecutionStateRestoreError,
);

console.log("runtime state machine smoke passed");
