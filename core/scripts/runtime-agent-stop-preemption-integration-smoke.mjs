import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_OUTCOME,
  AgentRuntimeRunExecutor,
  AgentRuntimeStopCancellationPort,
  BaseContextCompiler,
  EXECUTION_CANCELLATION_REASON,
  INPUT_EVENT_TYPE,
  InputRouter,
  OUTPUT_EVENT_TYPE,
  RUN_STATUS,
  RuntimeInputOutcomeController,
  RuntimeInputPump,
  RuntimeStopInputHandler,
  RuntimeUserMessageInputHandler,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";

const conversationId = "conversation-agent-stop-preemption";
const timestamp = "2026-08-01T23:20:00.000Z";
const forbidden = [
  "FORBIDDEN_STOP_ACTIVE_TEXT",
  "FORBIDDEN_STOP_QUEUED_TEXT",
  "FORBIDDEN_STOP_SYSTEM_PROMPT",
  "FORBIDDEN_STOP_PROVIDER_ERROR",
  "FORBIDDEN_STOP_PATH",
];

class IncrementingEventIdFactory {
  count = 0;

  create(input) {
    this.count += 1;
    return `evt-stop-preemption-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  events = [];
  nextSequence = 4;

  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.nextSequence++,
      recordedAt: timestamp,
    });
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
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
    return new CollectingLogger(this.entries, {
      ...this.bindings,
      ...bindings,
    });
  }

  record(level, event, fields) {
    this.entries.push({
      level,
      event,
      fields: { ...this.bindings, ...fields },
    });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function persistedInput(sequence, eventType, priority, text) {
  return Object.freeze({
    id: `input-agent-stop-preemption-${sequence}`,
    conversationId,
    eventType,
    schemaVersion: 1,
    priority,
    timestamp,
    correlationId: `correlation-agent-stop-preemption-${sequence}`,
    payload: Object.freeze({ text }),
    direction: "input",
    sequence,
    recordedAt: timestamp,
  });
}

function runtimeUserMessage(input) {
  return Object.freeze({
    id: `message-agent-stop-preemption-${input.sequence}`,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp,
    payload: Object.freeze({
      content: Object.freeze([
        Object.freeze({ type: "text", text: input.payload.text }),
      ]),
    }),
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for Agent Stop preemption integration");
}

const activeInput = persistedInput(
  1,
  INPUT_EVENT_TYPE.userMessage,
  500,
  "FORBIDDEN_STOP_ACTIVE_TEXT",
);
const queuedInput = persistedInput(
  2,
  INPUT_EVENT_TYPE.userMessage,
  500,
  "FORBIDDEN_STOP_QUEUED_TEXT",
);
const stopInput = persistedInput(
  3,
  INPUT_EVENT_TYPE.systemStop,
  1000,
  "FORBIDDEN_STOP_PROVIDER_ERROR FORBIDDEN_STOP_PATH",
);
const logs = [];
const logger = new CollectingLogger(logs);
const eventSink = new RecordingSink();
const eventIdFactory = new IncrementingEventIdFactory();
const lifecycleController = new TurnController({
  conversationId,
  eventIdFactory,
  eventSink,
  runIdGenerator: Object.freeze({
    generate: () => "run-agent-stop-preemption-1",
  }),
  turnIdGenerator: Object.freeze({
    generate: () => "turn-agent-stop-preemption-1",
  }),
  clock: Object.freeze({ now: () => timestamp }),
  logger,
});
const outcomeRecorder = new RuntimeInputOutcomeController({
  conversationId,
  eventIdFactory,
  eventSink,
  clock: Object.freeze({ now: () => timestamp }),
  logger,
});
const router = new InputRouter({ conversationId, logger });

const providerStarted = deferred();
const providerCancelled = deferred();
const adapterSettled = deferred();
const adapterRequests = [];
const cancelRequests = [];
const adapter = Object.freeze({
  stream: async (request) => {
    adapterRequests.push(request);
    await lifecycleController.beginTurn();
    providerStarted.resolve();
    await providerCancelled.promise;
    adapterSettled.resolve();
    return Object.freeze({
      conversationId,
      runId: request.runId,
      outcome: AGENT_RUNTIME_OUTCOME.cancelled,
    });
  },
  cancel: async (request) => {
    cancelRequests.push(request);
    assert.equal(lifecycleController.getTurnSnapshot().status, TURN_STATUS.stopping);
    assert.equal(lifecycleController.getRunSnapshot().status, RUN_STATUS.stopping);
    providerCancelled.resolve();
    await adapterSettled.promise;
  },
});
const runExecutor = new AgentRuntimeRunExecutor({
  conversationId,
  preparationSource: Object.freeze({
    prepare: async (request) => Object.freeze({
      conversationId,
      runId: request.runId,
      systemPrompt: "FORBIDDEN_STOP_SYSTEM_PROMPT FORBIDDEN_STOP_PATH",
      contextMessages: Object.freeze([]),
      invocation: Object.freeze({
        kind: "prompt",
        messages: Object.freeze([runtimeUserMessage(request.input)]),
      }),
    }),
  }),
  contextCompiler: new BaseContextCompiler({ logger }),
  agentAdapter: adapter,
  lifecycleController,
  logger,
});
const turnHandler = new RuntimeUserMessageInputHandler({
  conversationId,
  lifecycleController,
  outcomeRecorder,
  runExecutor,
  logger,
});
const cancellationPort = new AgentRuntimeStopCancellationPort({
  conversationId,
  agentAdapter: adapter,
  logger,
});
const controlHandler = new RuntimeStopInputHandler({
  conversationId,
  stopFence: router,
  lifecycleController,
  outcomeRecorder,
  cancellationPort,
  logger,
});
const pump = new RuntimeInputPump({
  conversationId,
  source: router,
  controlHandler,
  turnHandler,
  clock: Object.freeze({ now: () => timestamp }),
  logger,
});

router.route(activeInput);
pump.start();
await providerStarted.promise;
assert.equal(adapterRequests.length, 1);
assert.equal(lifecycleController.getRunSnapshot().status, RUN_STATUS.running);
assert.equal(lifecycleController.getTurnSnapshot().status, TURN_STATUS.running);

router.route(queuedInput);
router.route(stopInput);
pump.wake();
await waitFor(
  () =>
    lifecycleController.getRunSnapshot()?.status === RUN_STATUS.cancelled &&
    lifecycleController.getTurnSnapshot()?.status === TURN_STATUS.cancelled &&
    outcomeRecorder.hasCompleted(queuedInput.id) &&
    outcomeRecorder.hasCompleted(stopInput.id),
);
await pump.stop();

assert.equal(adapterRequests.length, 1);
assert.equal(cancelRequests.length, 1);
assert.deepEqual(cancelRequests[0], {
  conversationId,
  runId: "run-agent-stop-preemption-1",
  turnId: "turn-agent-stop-preemption-1",
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
assert.equal(Object.isFrozen(cancelRequests[0]), true);
assert.equal(router.turnInbox.size, 0);
assert.equal(outcomeRecorder.hasCompleted(activeInput.id), true);

assert.equal(lifecycleController.getTurnSnapshot().status, TURN_STATUS.cancelled);
assert.equal(
  lifecycleController.getTurnSnapshot().cancellationReason,
  EXECUTION_CANCELLATION_REASON.stop,
);
assert.equal(lifecycleController.getRunSnapshot().status, RUN_STATUS.cancelled);
assert.equal(
  lifecycleController.getRunSnapshot().cancellationReason,
  EXECUTION_CANCELLATION_REASON.stop,
);

const lifecycleOrder = eventSink.events
  .filter((event) =>
    [
      OUTPUT_EVENT_TYPE.agentRunStateChanged,
      OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    ].includes(event.getEventType()),
  )
  .map((event) => `${event.getEventType()}:${event.payload.current}`);
assert.deepEqual(lifecycleOrder, [
  `${OUTPUT_EVENT_TYPE.agentRunStateChanged}:queued`,
  `${OUTPUT_EVENT_TYPE.agentRunStateChanged}:running`,
  `${OUTPUT_EVENT_TYPE.agentTurnStateChanged}:running`,
  `${OUTPUT_EVENT_TYPE.agentTurnStateChanged}:stopping`,
  `${OUTPUT_EVENT_TYPE.agentRunStateChanged}:stopping`,
  `${OUTPUT_EVENT_TYPE.agentTurnStateChanged}:cancelled`,
  `${OUTPUT_EVENT_TYPE.agentRunStateChanged}:cancelled`,
]);

const outcomes = eventSink.events
  .filter((event) => event.getEventType() === OUTPUT_EVENT_TYPE.runtimeInputProcessed)
  .map((event) => ({
    inputEventId: event.inputEvent.id,
    outcome: event.payload.outcome,
    cancellationReason: event.payload.cancellationReason,
  }));
assert.deepEqual(outcomes, [
  {
    inputEventId: activeInput.id,
    outcome: "consumed",
    cancellationReason: undefined,
  },
  {
    inputEventId: queuedInput.id,
    outcome: "cancelled_before_run",
    cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
  },
  {
    inputEventId: stopInput.id,
    outcome: "consumed",
    cancellationReason: undefined,
  },
]);

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some((entry) => entry.event === "runtime.input_pump.control_started"),
  true,
);
assert.equal(
  logs.some((entry) => entry.event === "runtime.stop.processing_completed"),
  true,
);

console.log("Task 3F-C Agent Stop preemption integration smoke passed");
