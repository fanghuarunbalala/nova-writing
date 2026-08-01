import assert from "node:assert/strict";
import {
  EXECUTION_CANCELLATION_REASON,
  INPUT_EVENT_TYPE,
  InputRouter,
  OUTPUT_EVENT_TYPE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RUNTIME_STOP_INPUT_FAILURE,
  RuntimeInputOutcomeController,
  RuntimeStopInputHandler,
  RuntimeStopInputHandlerError,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";

const conversationId = "conversation-stop-handler";
const timestamp = "2026-08-01T21:00:00.000Z";
const forbidden = [
  "FORBIDDEN_STOP_PAYLOAD",
  "FORBIDDEN_STOP_PROMPT",
  "FORBIDDEN_STOP_STACK",
  "FORBIDDEN_STOP_PATH",
];

class IncrementingEventIdFactory {
  constructor() {
    this.count = 0;
  }

  create(input) {
    this.count += 1;
    return `evt-stop-handler-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  constructor() {
    this.events = [];
    this.failNext = false;
  }

  async append(event) {
    this.events.push(event);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("FORBIDDEN_STOP_STACK");
    }
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: timestamp,
    });
  }
}

class CollectingLogger {
  constructor(records = [], bindings = {}) {
    this.records = records;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.records, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.records.push({ level, event, ...this.bindings, ...fields });
  }
}

function persistedInput(sequence, eventType, priority, correlationId) {
  return Object.freeze({
    id: `input-stop-handler-${sequence}`,
    conversationId,
    eventType,
    schemaVersion: 1,
    priority,
    timestamp,
    ...(correlationId !== undefined ? { correlationId } : {}),
    payload: Object.freeze({ text: "FORBIDDEN_STOP_PAYLOAD" }),
    direction: "input",
    sequence,
    recordedAt: timestamp,
  });
}

function userInput(sequence) {
  return persistedInput(
    sequence,
    INPUT_EVENT_TYPE.userMessage,
    500,
    `correlation-stop-user-${sequence}`,
  );
}

function stopInput(sequence) {
  return persistedInput(
    sequence,
    INPUT_EVENT_TYPE.systemStop,
    1000,
    `correlation-stop-${sequence}`,
  );
}

function createExecution(runId, turnId) {
  const sink = new RecordingSink();
  const eventIdFactory = new IncrementingEventIdFactory();
  const lifecycleController = new TurnController({
    conversationId,
    eventIdFactory,
    eventSink: sink,
    runIdGenerator: Object.freeze({ generate: () => runId }),
    turnIdGenerator: Object.freeze({ generate: () => turnId }),
    clock: Object.freeze({ now: () => timestamp }),
  });
  const outcomeRecorder = new RuntimeInputOutcomeController({
    conversationId,
    eventIdFactory,
    eventSink: sink,
    clock: Object.freeze({ now: () => timestamp }),
  });
  return { sink, lifecycleController, outcomeRecorder };
}

async function activateRun(execution, originSequence, withTurn = true) {
  await execution.lifecycleController.beginRun({
    inputEvent: {
      id: `input-active-origin-${originSequence}`,
      eventType: INPUT_EVENT_TYPE.userMessage,
      sequence: originSequence,
    },
  });
  await execution.lifecycleController.transitionRun({
    current: RUN_STATUS.running,
    reason: RUN_STATE_CHANGE_REASON.executionStarted,
  });
  if (withTurn) await execution.lifecycleController.beginTurn();
}

function createHandler(options) {
  return new RuntimeStopInputHandler({
    conversationId,
    stopFence: options.router,
    lifecycleController: options.lifecycleController,
    outcomeRecorder: options.outcomeRecorder,
    cancellationPort: options.cancellationPort,
    logger: new CollectingLogger(options.logs),
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for Stop smoke-test condition");
}

const activeLogs = [];
const activeRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(activeLogs),
});
activeRouter.route(userInput(1));
activeRouter.route(userInput(4));
activeRouter.route(userInput(6));
const activeExecution = createExecution(
  "run-stop-handler-active",
  "turn-stop-handler-active",
);
await activateRun(activeExecution, 2, true);
const eventStart = activeExecution.sink.events.length;
const cancellationRequests = [];
const activeHandler = createHandler({
  router: activeRouter,
  lifecycleController: activeExecution.lifecycleController,
  outcomeRecorder: activeExecution.outcomeRecorder,
  logs: activeLogs,
  cancellationPort: Object.freeze({
    cancel: async (request) => {
      cancellationRequests.push(request);
      assert.equal(
        activeExecution.lifecycleController.getTurnSnapshot().status,
        TURN_STATUS.stopping,
      );
      assert.equal(
        activeExecution.lifecycleController.getRunSnapshot().status,
        RUN_STATUS.stopping,
      );
    },
  }),
});
const activeResult = await activeHandler.process(stopInput(5));
assert.deepEqual(activeResult, {
  stopInput: {
    id: "input-stop-handler-5",
    eventType: INPUT_EVENT_TYPE.systemStop,
    sequence: 5,
  },
  runId: "run-stop-handler-active",
  turnId: "turn-stop-handler-active",
  runStatus: RUN_STATUS.cancelled,
  turnStatus: TURN_STATUS.cancelled,
  cancelledInputs: [
    {
      id: "input-stop-handler-1",
      eventType: INPUT_EVENT_TYPE.userMessage,
      sequence: 1,
    },
    {
      id: "input-stop-handler-4",
      eventType: INPUT_EVENT_TYPE.userMessage,
      sequence: 4,
    },
  ],
  stopOutcomeReceiptSequence: 10,
});
assert.equal(Object.isFrozen(activeResult), true);
assert.equal(Object.isFrozen(activeResult.cancelledInputs), true);
assert.equal(activeRouter.turnInbox.peek().sequence, 6);
assert.equal(cancellationRequests.length, 1);
assert.deepEqual(cancellationRequests[0], {
  conversationId,
  reason: EXECUTION_CANCELLATION_REASON.stop,
  stopInput: activeResult.stopInput,
  runId: "run-stop-handler-active",
  turnId: "turn-stop-handler-active",
});
assert.equal(Object.isFrozen(cancellationRequests[0]), true);

const activeStopEvents = activeExecution.sink.events.slice(eventStart);
assert.deepEqual(
  activeStopEvents.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.runtimeInputProcessed,
    OUTPUT_EVENT_TYPE.runtimeInputProcessed,
    OUTPUT_EVENT_TYPE.runtimeInputProcessed,
  ],
);
assert.deepEqual(
  activeStopEvents.slice(0, 4).map((event) => event.payload.current),
  [TURN_STATUS.stopping, RUN_STATUS.stopping, TURN_STATUS.cancelled, RUN_STATUS.cancelled],
);
assert.deepEqual(
  activeStopEvents.slice(4).map((event) => event.payload.outcome),
  ["cancelled_before_run", "cancelled_before_run", "consumed"],
);
assert.equal(
  activeStopEvents[4].payload.cancellationReason,
  EXECUTION_CANCELLATION_REASON.stop,
);
assert.equal(activeStopEvents[0].causationId, "input-stop-handler-5");
assert.equal(activeStopEvents[6].runId, "run-stop-handler-active");
assert.equal(activeStopEvents[6].turnId, "turn-stop-handler-active");

const idleLogs = [];
const idleRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(idleLogs),
});
idleRouter.route(userInput(20));
idleRouter.route(userInput(24));
const idleExecution = createExecution("run-stop-handler-idle", "turn-stop-handler-idle");
let idleCancellationCount = 0;
const idleHandler = createHandler({
  router: idleRouter,
  lifecycleController: idleExecution.lifecycleController,
  outcomeRecorder: idleExecution.outcomeRecorder,
  logs: idleLogs,
  cancellationPort: Object.freeze({
    cancel: async () => {
      idleCancellationCount += 1;
    },
  }),
});
const idleResult = await idleHandler.process(stopInput(22));
assert.equal(idleCancellationCount, 0);
assert.equal(idleResult.runId, undefined);
assert.equal(idleResult.cancelledInputs.length, 1);
assert.equal(idleRouter.turnInbox.peek().sequence, 24);
assert.deepEqual(
  idleExecution.sink.events.map((event) => event.payload.outcome),
  ["cancelled_before_run", "consumed"],
);

const appendFailureLogs = [];
const appendFailureRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(appendFailureLogs),
});
appendFailureRouter.route(userInput(31));
const appendFailureExecution = createExecution(
  "run-stop-handler-append-failure",
  "turn-stop-handler-append-failure",
);
await activateRun(appendFailureExecution, 30, true);
appendFailureExecution.sink.failNext = true;
const emergencyRequests = [];
const appendFailureHandler = createHandler({
  router: appendFailureRouter,
  lifecycleController: appendFailureExecution.lifecycleController,
  outcomeRecorder: appendFailureExecution.outcomeRecorder,
  logs: appendFailureLogs,
  cancellationPort: Object.freeze({
    cancel: async (request) => {
      emergencyRequests.push(request);
    },
  }),
});
await assert.rejects(
  () => appendFailureHandler.process(stopInput(32)),
  (error) =>
    error instanceof RuntimeStopInputHandlerError &&
    error.failure === RUNTIME_STOP_INPUT_FAILURE.turnStoppingFailed,
);
await waitFor(() => emergencyRequests.length === 1);
assert.equal(
  appendFailureExecution.lifecycleController.getPendingCommit().scope,
  "turn",
);
assert.equal(appendFailureRouter.turnInbox.size, 0);

const cancellationFailureLogs = [];
const cancellationFailureRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(cancellationFailureLogs),
});
const cancellationFailureExecution = createExecution(
  "run-stop-handler-cancel-failure",
  "turn-stop-handler-cancel-failure",
);
await activateRun(cancellationFailureExecution, 40, false);
let cancellationFailureCalls = 0;
const cancellationFailureHandler = createHandler({
  router: cancellationFailureRouter,
  lifecycleController: cancellationFailureExecution.lifecycleController,
  outcomeRecorder: cancellationFailureExecution.outcomeRecorder,
  logs: cancellationFailureLogs,
  cancellationPort: Object.freeze({
    cancel: async () => {
      cancellationFailureCalls += 1;
      throw new Error("FORBIDDEN_STOP_PROMPT");
    },
  }),
});
await assert.rejects(
  () => cancellationFailureHandler.process(stopInput(41)),
  (error) =>
    error instanceof RuntimeStopInputHandlerError &&
    error.failure === RUNTIME_STOP_INPUT_FAILURE.cancellationFailed,
);
await waitFor(() => cancellationFailureCalls === 2);
assert.equal(
  cancellationFailureExecution.lifecycleController.getRunSnapshot().status,
  RUN_STATUS.stopping,
);

const outcomeFailureLogs = [];
const outcomeFailureRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(outcomeFailureLogs),
});
outcomeFailureRouter.route(userInput(50));
const outcomeFailureExecution = createExecution(
  "run-stop-handler-outcome-failure",
  "turn-stop-handler-outcome-failure",
);
const outcomeFailureHandler = createHandler({
  router: outcomeFailureRouter,
  lifecycleController: outcomeFailureExecution.lifecycleController,
  outcomeRecorder: Object.freeze({
    record: async () => {
      throw new Error("FORBIDDEN_STOP_PATH");
    },
  }),
  logs: outcomeFailureLogs,
  cancellationPort: Object.freeze({ cancel: async () => undefined }),
});
await assert.rejects(
  () => outcomeFailureHandler.process(stopInput(51)),
  (error) =>
    error instanceof RuntimeStopInputHandlerError &&
    error.failure === RUNTIME_STOP_INPUT_FAILURE.queuedOutcomeFailed,
);
assert.equal(outcomeFailureRouter.turnInbox.size, 0);

const invalidLogs = [];
const invalidRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(invalidLogs),
});
const invalidExecution = createExecution("run-stop-handler-invalid", "turn-stop-handler-invalid");
const invalidHandler = createHandler({
  router: invalidRouter,
  lifecycleController: invalidExecution.lifecycleController,
  outcomeRecorder: invalidExecution.outcomeRecorder,
  logs: invalidLogs,
  cancellationPort: Object.freeze({ cancel: async () => undefined }),
});
await assert.rejects(
  () => invalidHandler.process(userInput(60)),
  (error) =>
    error instanceof RuntimeStopInputHandlerError &&
    error.failure === RUNTIME_STOP_INPUT_FAILURE.invalidInput,
);
assert.equal(invalidExecution.sink.events.length, 0);

const allLogs = [
  ...activeLogs,
  ...idleLogs,
  ...appendFailureLogs,
  ...cancellationFailureLogs,
  ...outcomeFailureLogs,
  ...invalidLogs,
];
const serializedLogs = JSON.stringify(allLogs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(allLogs.some((record) => record.event === "runtime.stop.fence_applied"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.stop.cancellation_completed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.stop.processing_completed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.stop.processing_failed"), true);

console.log("Runtime Stop Input Handler smoke passed");
