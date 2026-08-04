import assert from "node:assert/strict";
import {
  InputRouter,
  RUNTIME_STARTUP_EXECUTION_FAILURE,
  RUNTIME_STARTUP_EXECUTION_STATUS,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RuntimeInputOutcomeController,
  RuntimeStartupExecutionError,
  RuntimeStartupExecutor,
  RuntimeStartupReconciler,
  Sha256RuntimeEventIdFactory,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../dist/node/index.js";

class FakeSink {
  constructor(options = {}) {
    this.events = [];
    this.nextSequence = options.nextSequence ?? 100;
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
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.nextSequence++,
      recordedAt: "2026-08-01T13:00:01.000Z",
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

const conversationId = "conversation-startup-executor";
const timestamp = "2026-08-01T13:00:00.000Z";
const eventIdFactory = new Sha256RuntimeEventIdFactory({
  hasher: new NodeSha256RuntimeEventIdHasher(),
});

function input(id, eventType, sequence, priority, payload, correlationId) {
  return Object.freeze({
    id,
    conversationId,
    eventType,
    schemaVersion: 1,
    priority,
    timestamp,
    ...(correlationId !== undefined ? { correlationId } : {}),
    payload: Object.freeze(payload),
    direction: "input",
    sequence,
    recordedAt: "2026-08-01T13:00:01.000Z",
  });
}

function createDependencies(options = {}) {
  const sink = options.sink ?? new FakeSink();
  const logs = options.logs ?? [];
  const outcomeController = new RuntimeInputOutcomeController({
    conversationId,
    eventIdFactory,
    eventSink: sink,
    clock: { now: () => timestamp },
    logger: new CollectingLogger(logs),
  });
  const turnController = new TurnController({
    conversationId,
    eventIdFactory,
    eventSink: sink,
    clock: { now: () => timestamp },
    logger: new CollectingLogger(logs),
  });
  const inputRouter = new InputRouter({
    conversationId,
    ...(options.turnCapacity !== undefined
      ? { turnCapacity: options.turnCapacity }
      : {}),
    logger: new CollectingLogger(logs),
  });
  const executor = new RuntimeStartupExecutor({
    conversationId,
    outcomeController,
    turnController,
    inputRouter,
    logger: new CollectingLogger(logs),
  });
  return { sink, logs, outcomeController, turnController, inputRouter, executor };
}

const secret = "FORBIDDEN_STARTUP_EXECUTOR_NOVEL_TEXT";
const claimedInput = input(
  "input-executor-claimed",
  "user.message",
  1,
  500,
  { text: secret },
  "correlation-executor",
);
const controlInput = input("input-executor-stop", "system.stop", 8, 1000, {});
const claimedReference = {
  id: claimedInput.id,
  eventType: claimedInput.eventType,
  sequence: claimedInput.sequence,
};
const terminalRun = Object.freeze({
  runId: "run-executor",
  inputEvent: Object.freeze(claimedReference),
  status: RUN_STATUS.completed,
  reason: RUN_STATE_CHANGE_REASON.executionCompleted,
  transitionOrdinal: 2,
});
const terminalTurn = Object.freeze({
  runId: terminalRun.runId,
  turnId: "turn-executor",
  status: TURN_STATUS.completed,
  reason: TURN_STATE_CHANGE_REASON.turnCompleted,
  transitionOrdinal: 1,
});
const reconciler = new RuntimeStartupReconciler();
const readyPlan = reconciler.reconcile({
  conversationId,
  throughSequence: 8,
  scannedEventCount: 8,
  processedInputCount: 0,
  pendingInputs: Object.freeze([claimedInput, controlInput]),
  unconfirmedRunInputs: Object.freeze([
    Object.freeze({ inputEvent: Object.freeze(claimedReference), runId: terminalRun.runId }),
  ]),
  run: terminalRun,
  turn: terminalTurn,
});

const happy = createDependencies();
const happyResult = await happy.executor.execute(readyPlan);
assert.equal(happyResult.repairCommits.length, 1);
assert.equal(happyResult.routeResults.length, 1);
assert.equal(happyResult.routeResults[0].sequence, controlInput.sequence);
assert.equal(happy.sink.events.length, 1);
assert.equal(happy.sink.events[0].inputEvent.id, claimedInput.id);
assert.equal(happy.sink.events[0].runId, terminalRun.runId);
assert.equal(happy.turnController.getRunSnapshot().status, RUN_STATUS.completed);
assert.equal(happy.turnController.getTurnSnapshot().status, TURN_STATUS.completed);
assert.equal(happy.inputRouter.controlInbox.peek().id, controlInput.id);
assert.equal(happy.executor.getSnapshot().status, RUNTIME_STARTUP_EXECUTION_STATUS.completed);
assert.equal(Object.isFrozen(happyResult), true);
assert.equal(Object.isFrozen(happyResult.repairCommits), true);
assert.equal(Object.isFrozen(happyResult.routeResults), true);
await assert.rejects(
  () => happy.executor.execute(readyPlan),
  (error) =>
    error instanceof RuntimeStartupExecutionError &&
    error.failure === RUNTIME_STARTUP_EXECUTION_FAILURE.alreadyStarted,
);

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
const blockedPlan = reconciler.reconcile({
  conversationId,
  throughSequence: 8,
  scannedEventCount: 8,
  processedInputCount: 0,
  pendingInputs: Object.freeze([claimedInput, controlInput]),
  unconfirmedRunInputs: Object.freeze([
    Object.freeze({ inputEvent: Object.freeze(claimedReference), runId: activeRun.runId }),
  ]),
  run: activeRun,
  turn: activeTurn,
});
const blocked = createDependencies();
const blockedResult = await blocked.executor.execute(blockedPlan);
assert.equal(blockedResult.repairCommits.length, 1);
assert.equal(blockedResult.routeResults.length, 1);
assert.equal(blockedResult.routeResults[0].sequence, controlInput.sequence);
assert.equal(
  blocked.turnController.getRunSnapshot().status,
  RUN_STATUS.failed,
);
assert.equal(
  blocked.turnController.getTurnSnapshot().status,
  TURN_STATUS.failed,
);
assert.equal(
  blocked.executor.getSnapshot().status,
  RUNTIME_STARTUP_EXECUTION_STATUS.completed,
);

const rawFailure = new Error("FORBIDDEN_STARTUP_EXECUTOR_RAW_ERROR");
const repairLogs = [];
const repairBlocked = createDependencies({
  sink: new FakeSink({ nextSequence: 200, failure: rawFailure }),
  logs: repairLogs,
});
const mutableRepairPlan = {
  ...readyPlan,
  outcomeRepairs: readyPlan.outcomeRepairs.map((repair) => ({
    ...repair,
    inputEvent: { ...repair.inputEvent },
  })),
  routableInputs: [...readyPlan.routableInputs],
};
await assert.rejects(
  () => repairBlocked.executor.execute(mutableRepairPlan),
  (error) =>
    error instanceof RuntimeStartupExecutionError &&
    error.failure === RUNTIME_STARTUP_EXECUTION_FAILURE.outcomePending,
);
mutableRepairPlan.outcomeRepairs[0].runId = "mutated-after-block";
mutableRepairPlan.outcomeRepairs.length = 0;
mutableRepairPlan.routableInputs.length = 0;
assert.equal(
  repairBlocked.executor.getSnapshot().status,
  RUNTIME_STARTUP_EXECUTION_STATUS.repairBlocked,
);
const firstRepairEvent = repairBlocked.sink.events[0];
const repairedResult = await repairBlocked.executor.resume();
assert.equal(repairBlocked.sink.events[1], firstRepairEvent);
assert.equal(repairBlocked.sink.events[1].runId, terminalRun.runId);
assert.equal(repairedResult.repairCommits.length, 1);
assert.equal(repairedResult.routeResults.length, 1);
assert.equal(
  repairBlocked.executor.getSnapshot().status,
  RUNTIME_STARTUP_EXECUTION_STATUS.completed,
);

const firstTurnInput = input(
  "input-executor-turn-1",
  "user.message",
  20,
  500,
  { text: "first" },
);
const secondTurnInput = input(
  "input-executor-turn-2",
  "user.message",
  21,
  500,
  { text: "second" },
);
const routePlan = reconciler.reconcile({
  conversationId,
  throughSequence: 21,
  scannedEventCount: 2,
  processedInputCount: 0,
  pendingInputs: Object.freeze([firstTurnInput, secondTurnInput]),
  unconfirmedRunInputs: Object.freeze([]),
});
const routeBlocked = createDependencies({ turnCapacity: 1 });
await assert.rejects(
  () => routeBlocked.executor.execute(routePlan),
  (error) =>
    error instanceof RuntimeStartupExecutionError &&
    error.failure === RUNTIME_STARTUP_EXECUTION_FAILURE.routeBlocked,
);
const routeSnapshot = routeBlocked.executor.getSnapshot();
assert.equal(routeSnapshot.status, RUNTIME_STARTUP_EXECUTION_STATUS.routeBlocked);
assert.equal(routeSnapshot.completedRouteCount, 1);
assert.equal(routeSnapshot.nextRouteSequence, secondTurnInput.sequence);
assert.equal(routeBlocked.inputRouter.dequeueNext().id, firstTurnInput.id);
const routedResult = await routeBlocked.executor.resume();
assert.equal(routedResult.routeResults.length, 2);
assert.equal(routeBlocked.inputRouter.dequeueNext().id, secondTurnInput.id);
await assert.rejects(
  () => routeBlocked.executor.resume(),
  (error) =>
    error instanceof RuntimeStartupExecutionError &&
    error.failure === RUNTIME_STARTUP_EXECUTION_FAILURE.noResumableExecution,
);

const invalid = createDependencies();
await assert.rejects(
  () => invalid.executor.execute({ ...readyPlan, conversationId: "different-conversation" }),
  (error) =>
    error instanceof RuntimeStartupExecutionError &&
    error.failure === RUNTIME_STARTUP_EXECUTION_FAILURE.invalidPlan,
);

const serializedLogs = JSON.stringify([
  ...happy.logs,
  ...blocked.logs,
  ...repairLogs,
  ...routeBlocked.logs,
]);
for (const forbidden of [
  secret,
  "FORBIDDEN_STARTUP_EXECUTOR_RAW_ERROR",
  "payload",
  "stack",
  "cause",
  "path",
  "workdir",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(
  happy.logs.some((entry) => entry.event === "runtime.startup.execution_completed"),
  true,
);
assert.equal(
  repairLogs.some((entry) => entry.event === "runtime.startup.outcome_repair_blocked"),
  true,
);
assert.equal(
  routeBlocked.logs.some((entry) => entry.event === "runtime.startup.route_blocked"),
  true,
);

console.log("runtime startup executor smoke passed");
