import assert from "node:assert/strict";
import {
  AgentRuntimeRunExecutor,
  BaseContextCompiler,
  CONVERSATION_RUNTIME_STATE,
  ConversationRuntime,
  ConversationRuntimeStateError,
  INPUT_EVENT_TYPE,
  InputRouter,
  OUTPUT_EVENT_TYPE,
  RUN_STATUS,
  RuntimeInputOutcomeController,
  RuntimeInputPump,
  RuntimeUserMessageInputHandler,
  TurnController,
} from "../dist/index.js";

const conversationId = "conversation-agent-runtime-crash";
const runtimeInstanceId = "runtime-agent-runtime-crash";
const timestamp = "2026-08-01T23:40:00.000Z";
const forbidden = [
  "FORBIDDEN_RUNTIME_CRASH_INPUT",
  "FORBIDDEN_RUNTIME_CRASH_PROMPT",
  "FORBIDDEN_RUNTIME_CRASH_ADAPTER_ERROR",
  "FORBIDDEN_RUNTIME_CRASH_PATH",
];

class IncrementingEventIdFactory {
  count = 0;

  create(input) {
    this.count += 1;
    return `evt-runtime-crash-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  events = [];
  nextSequence = 2;

  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId,
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

function persistedInput() {
  return Object.freeze({
    id: "input-agent-runtime-crash-1",
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    correlationId: "correlation-agent-runtime-crash-1",
    payload: Object.freeze({ text: "FORBIDDEN_RUNTIME_CRASH_INPUT" }),
    direction: "input",
    sequence: 1,
    recordedAt: timestamp,
  });
}

function runtimeUserMessage(input) {
  return Object.freeze({
    id: "message-agent-runtime-crash-1",
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

const input = persistedInput();
const logs = [];
const logger = new CollectingLogger(logs);
const eventSink = new RecordingSink();
const eventIdFactory = new IncrementingEventIdFactory();
const lifecycleController = new TurnController({
  conversationId,
  eventIdFactory,
  eventSink,
  runIdGenerator: Object.freeze({ generate: () => "run-agent-runtime-crash-1" }),
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
const runExecutor = new AgentRuntimeRunExecutor({
  conversationId,
  preparationSource: Object.freeze({
    prepare: async (request) => Object.freeze({
      conversationId,
      runId: request.runId,
      systemPrompt: "FORBIDDEN_RUNTIME_CRASH_PROMPT FORBIDDEN_RUNTIME_CRASH_PATH",
      contextMessages: Object.freeze([]),
      invocation: Object.freeze({
        kind: "prompt",
        messages: Object.freeze([runtimeUserMessage(request.input)]),
      }),
    }),
  }),
  contextCompiler: new BaseContextCompiler({ logger }),
  agentAdapter: Object.freeze({
    stream: async () => {
      throw new Error(
        "FORBIDDEN_RUNTIME_CRASH_ADAPTER_ERROR FORBIDDEN_RUNTIME_CRASH_PATH",
      );
    },
    cancel: async () => undefined,
  }),
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
const pump = new RuntimeInputPump({
  conversationId,
  source: router,
  controlHandler: Object.freeze({ handle: async () => undefined }),
  turnHandler,
  clock: Object.freeze({ now: () => timestamp }),
  logger,
});
const startupResult = Object.freeze({
  conversationId,
  runtimeInstanceId,
  activationReason: "explicit_restore",
  throughSequence: 0,
  scannedEventCount: 0,
  processedInputCount: 0,
  outcomeRepairCount: 0,
  routedInputCount: 0,
});
const runtime = new ConversationRuntime({
  conversationId,
  runtimeInstanceId,
  startupCoordinator: Object.freeze({
    start: async () => startupResult,
  }),
  inputResolver: Object.freeze({
    resolve: async (reference) => {
      assert.deepEqual(reference, {
        conversationId,
        inputEventId: input.id,
        eventType: input.eventType,
        sequence: input.sequence,
      });
      return input;
    },
  }),
  inputRouter: router,
  inputPump: pump,
  clock: Object.freeze({ now: () => timestamp }),
  logger,
});

assert.deepEqual(await runtime.start(Object.freeze({})), startupResult);
assert.equal(runtime.state, CONVERSATION_RUNTIME_STATE.online);
await runtime.dispatchInput(
  Object.freeze({
    conversationId,
    inputEventId: input.id,
    eventType: input.eventType,
    sequence: input.sequence,
  }),
);

assert.deepEqual(await runtime.waitForExit(), {
  kind: "crashed",
  exitedAt: timestamp,
  errorName: "ConversationRuntimeInputPumpError",
  errorCode: "CONVERSATION_RUNTIME_INPUT_PUMP_FAILED",
});
assert.equal(runtime.state, CONVERSATION_RUNTIME_STATE.crashed);
assert.deepEqual(await pump.waitForExit(), {
  kind: "failed",
  exitedAt: timestamp,
  scope: "turn",
  errorName: "RuntimeInputPumpFailureError",
  errorCode: "RUNTIME_INPUT_PUMP_FAILED",
  inputEventId: input.id,
  eventType: input.eventType,
  sequence: input.sequence,
});
assert.equal(outcomeRecorder.hasCompleted(input.id), true);
assert.equal(lifecycleController.getRunSnapshot().status, RUN_STATUS.running);
assert.equal(lifecycleController.getTurnSnapshot(), undefined);
assert.deepEqual(
  eventSink.events.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.runtimeInputProcessed,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
  ],
);
await assert.rejects(
  () =>
    runtime.dispatchInput({
      conversationId,
      inputEventId: "input-after-crash",
      eventType: INPUT_EVENT_TYPE.userMessage,
      sequence: 2,
    }),
  ConversationRuntimeStateError,
);

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.input_pump.failed" &&
      entry.fields.scope === "turn",
  ),
  true,
);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.lifecycle.state_changed" &&
      entry.fields.state === CONVERSATION_RUNTIME_STATE.crashed,
  ),
  true,
);

console.log("Task 3F-E Conversation Agent Runtime crash smoke passed");
