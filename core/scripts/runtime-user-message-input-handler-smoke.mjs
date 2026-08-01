import assert from "node:assert/strict";
import {
  EXECUTION_CANCELLATION_REASON,
  INPUT_EVENT_TYPE,
  OUTPUT_EVENT_TYPE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RUNTIME_USER_MESSAGE_INPUT_FAILURE,
  RuntimeInputOutcomeController,
  RuntimeUserMessageInputHandler,
  RuntimeUserMessageInputHandlerError,
  TurnController,
} from "../dist/index.js";

const conversationId = "conversation-user-message-handler";
const timestamp = "2026-08-01T20:00:00.000Z";
const forbidden = [
  "FORBIDDEN_USER_MESSAGE_PAYLOAD",
  "FORBIDDEN_USER_MESSAGE_PROMPT",
  "FORBIDDEN_USER_MESSAGE_STACK",
  "FORBIDDEN_USER_MESSAGE_PATH",
];

class IncrementingEventIdFactory {
  constructor() {
    this.count = 0;
  }

  create(input) {
    this.count += 1;
    return `evt-user-handler-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  constructor() {
    this.events = [];
  }

  async append(event) {
    this.events.push(event);
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

function persistedUserInput(sequence, payload = {}) {
  return {
    id: `input-user-handler-${sequence}`,
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    correlationId: `correlation-user-handler-${sequence}`,
    payload,
    direction: "input",
    sequence,
    recordedAt: timestamp,
  };
}

function createControllers(runId) {
  const sink = new RecordingSink();
  const eventIdFactory = new IncrementingEventIdFactory();
  const lifecycleController = new TurnController({
    conversationId,
    eventIdFactory,
    eventSink: sink,
    runIdGenerator: Object.freeze({ generate: () => runId }),
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

function createHandler(options) {
  return new RuntimeUserMessageInputHandler({
    conversationId,
    lifecycleController: options.lifecycleController,
    outcomeRecorder: options.outcomeRecorder,
    runExecutor: options.runExecutor,
    logger: new CollectingLogger(options.logs),
  });
}

const completedLogs = [];
const completed = createControllers("run-user-handler-completed");
let completedExecutorInput;
const completedHandler = createHandler({
  ...completed,
  logs: completedLogs,
  runExecutor: Object.freeze({
    execute: async (request) => {
      completedExecutorInput = request.input;
      await completed.lifecycleController.transitionRun({
        current: RUN_STATUS.completed,
        reason: RUN_STATE_CHANGE_REASON.executionCompleted,
      });
    },
  }),
});
const mutablePayload = { text: "FORBIDDEN_USER_MESSAGE_PAYLOAD" };
const mutableInput = persistedUserInput(1, mutablePayload);
const completedPromise = completedHandler.process(mutableInput);
mutablePayload.text = "mutated-after-process";
mutableInput.payload = { text: "mutated-input-payload" };
const completedResult = await completedPromise;
assert.deepEqual(completedResult, {
  inputEvent: {
    id: "input-user-handler-1",
    eventType: INPUT_EVENT_TYPE.userMessage,
    sequence: 1,
  },
  runId: "run-user-handler-completed",
  terminalStatus: RUN_STATUS.completed,
  outcomeReceiptSequence: 2,
});
assert.equal(Object.isFrozen(completedResult), true);
assert.equal(Object.isFrozen(completedResult.inputEvent), true);
assert.equal(Object.isFrozen(completedExecutorInput), true);
assert.equal(Object.isFrozen(completedExecutorInput.payload), true);
assert.equal(completedExecutorInput.payload.text, "FORBIDDEN_USER_MESSAGE_PAYLOAD");
assert.deepEqual(
  completed.sink.events.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.runtimeInputProcessed,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
  ],
);
assert.deepEqual(
  completed.sink.events
    .filter((event) => event.getEventType() === OUTPUT_EVENT_TYPE.agentRunStateChanged)
    .map((event) => event.payload.current),
  [RUN_STATUS.queued, RUN_STATUS.running, RUN_STATUS.completed],
);
assert.equal(completed.sink.events[1].payload.outcome, "consumed");
assert.equal(completed.sink.events[1].runId, "run-user-handler-completed");
assert.equal(completed.sink.events[0].correlationId, "correlation-user-handler-1");
assert.equal(completed.sink.events[1].correlationId, "correlation-user-handler-1");

const cancelledLogs = [];
const cancelled = createControllers("run-user-handler-cancelled");
const cancelledHandler = createHandler({
  ...cancelled,
  logs: cancelledLogs,
  runExecutor: Object.freeze({
    execute: async () => {
      await cancelled.lifecycleController.transitionRun({
        current: RUN_STATUS.stopping,
        reason: RUN_STATE_CHANGE_REASON.stopRequested,
      });
      await cancelled.lifecycleController.transitionRun({
        current: RUN_STATUS.cancelled,
        reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
        cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
      });
    },
  }),
});
const cancelledResult = await cancelledHandler.process(persistedUserInput(2));
assert.equal(cancelledResult.terminalStatus, RUN_STATUS.cancelled);
assert.equal(
  cancelled.lifecycleController.getRunSnapshot().cancellationReason,
  EXECUTION_CANCELLATION_REASON.stop,
);

const invalidLogs = [];
const invalid = createControllers("run-user-handler-invalid");
const invalidHandler = createHandler({
  ...invalid,
  logs: invalidLogs,
  runExecutor: Object.freeze({ execute: async () => undefined }),
});
await assert.rejects(
  () =>
    invalidHandler.process({
      ...persistedUserInput(3),
      eventType: INPUT_EVENT_TYPE.compactContext,
    }),
  (error) =>
    error instanceof RuntimeUserMessageInputHandlerError &&
    error.failure === RUNTIME_USER_MESSAGE_INPUT_FAILURE.invalidInput,
);
assert.equal(invalid.sink.events.length, 0);

const activeLogs = [];
const active = createControllers("run-user-handler-active");
await active.lifecycleController.beginRun({
  inputEvent: {
    id: "input-existing-active",
    eventType: INPUT_EVENT_TYPE.userMessage,
    sequence: 30,
  },
});
const activeHandler = createHandler({
  ...active,
  logs: activeLogs,
  runExecutor: Object.freeze({ execute: async () => undefined }),
});
await assert.rejects(
  () => activeHandler.process(persistedUserInput(4)),
  (error) =>
    error instanceof RuntimeUserMessageInputHandlerError &&
    error.failure === RUNTIME_USER_MESSAGE_INPUT_FAILURE.activeRun,
);
assert.equal(active.sink.events.length, 1);

const incompleteLogs = [];
const incomplete = createControllers("run-user-handler-incomplete");
const incompleteHandler = createHandler({
  ...incomplete,
  logs: incompleteLogs,
  runExecutor: Object.freeze({ execute: async () => undefined }),
});
await assert.rejects(
  () => incompleteHandler.process(persistedUserInput(5)),
  (error) =>
    error instanceof RuntimeUserMessageInputHandlerError &&
    error.failure === RUNTIME_USER_MESSAGE_INPUT_FAILURE.runNotTerminal,
);
assert.equal(incomplete.lifecycleController.getRunSnapshot().status, RUN_STATUS.running);

const executorFailureLogs = [];
const executorFailure = createControllers("run-user-handler-executor-failure");
const executorFailureHandler = createHandler({
  ...executorFailure,
  logs: executorFailureLogs,
  runExecutor: Object.freeze({
    execute: async () => {
      const error = new Error("FORBIDDEN_USER_MESSAGE_PROMPT");
      error.name = "FORBIDDEN_USER_MESSAGE_STACK";
      error.code = "FORBIDDEN_USER_MESSAGE_PATH";
      throw error;
    },
  }),
});
await assert.rejects(
  () => executorFailureHandler.process(persistedUserInput(6)),
  (error) =>
    error instanceof RuntimeUserMessageInputHandlerError &&
    error.failure === RUNTIME_USER_MESSAGE_INPUT_FAILURE.executorFailed &&
    !error.message.includes("FORBIDDEN"),
);

const outcomeFailureLogs = [];
const outcomeFailureController = createControllers("run-user-handler-outcome-failure");
const outcomeFailureHandler = createHandler({
  lifecycleController: outcomeFailureController.lifecycleController,
  outcomeRecorder: Object.freeze({
    record: async () => {
      throw new Error("FORBIDDEN_USER_MESSAGE_PATH");
    },
  }),
  logs: outcomeFailureLogs,
  runExecutor: Object.freeze({ execute: async () => undefined }),
});
await assert.rejects(
  () => outcomeFailureHandler.process(persistedUserInput(7)),
  (error) =>
    error instanceof RuntimeUserMessageInputHandlerError &&
    error.failure === RUNTIME_USER_MESSAGE_INPUT_FAILURE.outcomeFailed,
);
assert.equal(outcomeFailureController.lifecycleController.getRunSnapshot().status, RUN_STATUS.queued);

const allLogs = [
  ...completedLogs,
  ...cancelledLogs,
  ...invalidLogs,
  ...activeLogs,
  ...incompleteLogs,
  ...executorFailureLogs,
  ...outcomeFailureLogs,
];
const serializedLogs = JSON.stringify(allLogs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(allLogs.some((record) => record.event === "runtime.user_message.claimed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.user_message.execution_started"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.user_message.processing_completed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.user_message.processing_failed"), true);

console.log("Runtime UserMessage Input Handler smoke passed");
