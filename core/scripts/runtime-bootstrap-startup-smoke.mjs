import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
  createCoreEventSchemaRegistry,
  InputRouter,
  JournalRuntimeReplayPlanner,
  RUNTIME_BOOTSTRAP_STARTUP_FAILURE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RuntimeBootstrapStartupCoordinator,
  RuntimeBootstrapStartupError,
  RuntimeInputOutcomeController,
  RuntimeStartupExecutor,
  RuntimeStartupReconciler,
  Sha256RuntimeEventIdFactory,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../dist/node/index.js";

class EmptyJournal {
  constructor() { this.requests = []; }
  async list(query) { this.requests.push(query); return { events: [], highWatermark: 0, hasPrevious: false, hasNext: false }; }
  async getHighWatermark() { return 0; }
  async getBySequence() { return undefined; }
  async getByEventId() { return undefined; }
}

class FakeSink {
  constructor() { this.events = []; this.nextSequence = 100; }
  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.nextSequence++,
      recordedAt: "2026-08-01T14:00:01.000Z",
    });
  }
}

class StaticReplayPlanner {
  constructor(plan, failure) { this.planValue = plan; this.failure = failure; this.requests = []; }
  async plan(request) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return this.planValue;
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

const conversationId = "conversation-bootstrap-startup";
const runtimeInstanceId = "runtime-bootstrap-startup";
const timestamp = "2026-08-01T14:00:00.000Z";
const eventIdFactory = new Sha256RuntimeEventIdFactory({
  hasher: new NodeSha256RuntimeEventIdHasher(),
});

function bootstrap(highWatermark, activationReason = CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore) {
  return Object.freeze({
    schemaVersion: CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
    runtimeInstanceId,
    activatedAt: timestamp,
    conversation: Object.freeze({
      metadata: Object.freeze({
        id: conversationId,
        workspaceId: "workspace-bootstrap",
        rootConversationId: conversationId,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastJournalSequence: highWatermark,
      }),
      activeAgentBinding: Object.freeze({
        id: "binding-bootstrap",
        conversationId,
        agentType: "novel.default",
        definitionVersion: "1",
        revision: 1,
        status: "active",
        createdAt: timestamp,
      }),
    }),
    workspace: Object.freeze({
      workspaceId: "workspace-bootstrap",
      workdir: "/FORBIDDEN_BOOTSTRAP_WORKDIR",
    }),
    activation: Object.freeze({ reason: activationReason }),
    journal: Object.freeze({ highWatermark }),
  });
}

function persistedInput(id, eventType, sequence, priority, payload) {
  return Object.freeze({
    id,
    conversationId,
    eventType,
    schemaVersion: 1,
    priority,
    timestamp,
    payload: Object.freeze(payload),
    direction: "input",
    sequence,
    recordedAt: "2026-08-01T14:00:01.000Z",
  });
}

function createActualCoordinator(replayPlanner, logs = []) {
  const sink = new FakeSink();
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
    logger: new CollectingLogger(logs),
  });
  const startupExecutor = new RuntimeStartupExecutor({
    conversationId,
    outcomeController,
    turnController,
    inputRouter,
    logger: new CollectingLogger(logs),
  });
  const coordinator = new RuntimeBootstrapStartupCoordinator({
    conversationId,
    runtimeInstanceId,
    replayPlanner,
    startupReconciler: new RuntimeStartupReconciler({
      logger: new CollectingLogger(logs),
    }),
    startupExecutor,
    logger: new CollectingLogger(logs),
  });
  return { coordinator, sink, turnController, inputRouter };
}

const emptyJournal = new EmptyJournal();
const emptyLogs = [];
const empty = createActualCoordinator(
  new JournalRuntimeReplayPlanner({
    journal: emptyJournal,
    eventSchemaRegistry: createCoreEventSchemaRegistry(),
    eventIdFactory,
    logger: new CollectingLogger(emptyLogs),
  }),
  emptyLogs,
);
const emptyResult = await empty.coordinator.start(bootstrap(0));
assert.deepEqual(emptyResult, {
  conversationId,
  runtimeInstanceId,
  activationReason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
  throughSequence: 0,
  scannedEventCount: 0,
  processedInputCount: 0,
  outcomeRepairCount: 0,
  routedInputCount: 0,
});
assert.equal(emptyJournal.requests.length, 0);
assert.equal(Object.isFrozen(emptyResult), true);
await assert.rejects(
  () => empty.coordinator.start(bootstrap(0)),
  (error) =>
    error instanceof RuntimeBootstrapStartupError &&
    error.failure === RUNTIME_BOOTSTRAP_STARTUP_FAILURE.alreadyStarted,
);

const claimedInput = persistedInput(
  "input-bootstrap-claimed",
  "user.message",
  1,
  500,
  { text: "FORBIDDEN_BOOTSTRAP_NOVEL_TEXT" },
);
const controlInput = persistedInput("input-bootstrap-stop", "system.stop", 8, 1000, {});
const inputReference = {
  id: claimedInput.id,
  eventType: claimedInput.eventType,
  sequence: claimedInput.sequence,
};
const terminalRun = Object.freeze({
  runId: "run-bootstrap",
  inputEvent: Object.freeze(inputReference),
  status: RUN_STATUS.completed,
  reason: RUN_STATE_CHANGE_REASON.executionCompleted,
  transitionOrdinal: 2,
});
const terminalTurn = Object.freeze({
  runId: terminalRun.runId,
  turnId: "turn-bootstrap",
  status: TURN_STATUS.completed,
  reason: TURN_STATE_CHANGE_REASON.turnCompleted,
  transitionOrdinal: 1,
});
const readyReplay = Object.freeze({
  conversationId,
  throughSequence: 8,
  scannedEventCount: 8,
  processedInputCount: 0,
  pendingInputs: Object.freeze([claimedInput, controlInput]),
  unconfirmedRunInputs: Object.freeze([
    Object.freeze({ inputEvent: Object.freeze(inputReference), runId: terminalRun.runId }),
  ]),
  run: terminalRun,
  turn: terminalTurn,
});
const readyLogs = [];
const readyPlanner = new StaticReplayPlanner(readyReplay);
const ready = createActualCoordinator(readyPlanner, readyLogs);
const readyResult = await ready.coordinator.start(
  bootstrap(8, CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery),
);
assert.equal(readyResult.activationReason, CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery);
assert.equal(readyResult.outcomeRepairCount, 1);
assert.equal(readyResult.routedInputCount, 1);
assert.equal(readyResult.restoredRunId, terminalRun.runId);
assert.equal(readyResult.restoredRunStatus, RUN_STATUS.completed);
assert.equal(readyResult.restoredTurnId, terminalTurn.turnId);
assert.equal(ready.sink.events.length, 1);
assert.equal(ready.inputRouter.controlInbox.peek().id, controlInput.id);
assert.deepEqual(readyPlanner.requests, [{ conversationId, throughSequence: 8 }]);

const activeReplay = Object.freeze({
  ...readyReplay,
  run: Object.freeze({
    ...terminalRun,
    status: RUN_STATUS.running,
    reason: RUN_STATE_CHANGE_REASON.executionStarted,
    transitionOrdinal: 1,
  }),
  turn: Object.freeze({
    ...terminalTurn,
    status: TURN_STATUS.running,
    reason: TURN_STATE_CHANGE_REASON.providerStarted,
    transitionOrdinal: 0,
  }),
});
const recovery = createActualCoordinator(new StaticReplayPlanner(activeReplay));
const recoveryResult = await recovery.coordinator.start(bootstrap(8));
assert.equal(
  recoveryResult.activationReason,
  CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
);
assert.equal(recoveryResult.outcomeRepairCount, 1);
assert.equal(recoveryResult.routedInputCount, 1);
assert.equal(recoveryResult.restoredRunId, activeReplay.run.runId);
assert.equal(recovery.inputRouter.peekNext().id, controlInput.id);
assert.equal(recovery.sink.events.length > 0, true);

const replayRawError = new Error("FORBIDDEN_BOOTSTRAP_REPLAY_RAW_ERROR");
const replayLogs = [];
const replayFailure = createActualCoordinator(
  new StaticReplayPlanner(undefined, replayRawError),
  replayLogs,
);
await assert.rejects(
  () => replayFailure.coordinator.start(bootstrap(0)),
  (error) =>
    error instanceof RuntimeBootstrapStartupError &&
    error.failure === RUNTIME_BOOTSTRAP_STARTUP_FAILURE.replayFailed,
);

const invalidLogs = [];
const invalid = createActualCoordinator(new StaticReplayPlanner(readyReplay), invalidLogs);
await assert.rejects(
  () =>
    invalid.coordinator.start({
      ...bootstrap(8),
      runtimeInstanceId: "different-runtime",
    }),
  (error) =>
    error instanceof RuntimeBootstrapStartupError &&
    error.failure === RUNTIME_BOOTSTRAP_STARTUP_FAILURE.invalidBootstrap,
);

const serializedLogs = JSON.stringify([
  ...emptyLogs,
  ...readyLogs,
  ...replayLogs,
  ...invalidLogs,
]);
for (const forbidden of [
  "FORBIDDEN_BOOTSTRAP_WORKDIR",
  "FORBIDDEN_BOOTSTRAP_NOVEL_TEXT",
  "FORBIDDEN_BOOTSTRAP_REPLAY_RAW_ERROR",
  "payload",
  "stack",
  "cause",
  "path",
  "workdir",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(
  readyLogs.some((entry) => entry.event === "runtime.bootstrap.startup_completed"),
  true,
);
assert.equal(
  replayLogs.some(
    (entry) =>
      entry.event === "runtime.bootstrap.startup_failed" &&
      entry.fields.failure === RUNTIME_BOOTSTRAP_STARTUP_FAILURE.replayFailed,
  ),
  true,
);

console.log("runtime Bootstrap startup coordinator smoke passed");
