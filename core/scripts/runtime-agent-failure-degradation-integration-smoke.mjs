import assert from "node:assert/strict";
import {
  AgentRuntimeRunExecutor,
  INPUT_EVENT_TYPE,
  InputRouter,
  OUTPUT_EVENT_TYPE,
  RUN_STATUS,
  RuntimeInputOutcomeController,
  RuntimeInputPump,
  RuntimeUserMessageInputHandler,
  TurnController,
} from "../dist/index.js";

const timestamp = "2026-08-01T23:30:00.000Z";
const forbidden = [
  "FORBIDDEN_FAILURE_INPUT_TEXT",
  "FORBIDDEN_FAILURE_SYSTEM_PROMPT",
  "FORBIDDEN_FAILURE_PREPARATION_ERROR",
  "FORBIDDEN_FAILURE_ASSEMBLER_ERROR",
  "FORBIDDEN_FAILURE_ADAPTER_ERROR",
  "FORBIDDEN_FAILURE_PATH",
];

class IncrementingEventIdFactory {
  constructor(prefix) {
    this.prefix = prefix;
    this.count = 0;
  }

  create(input) {
    this.count += 1;
    return `evt-${this.prefix}-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  constructor(conversationId) {
    this.conversationId = conversationId;
    this.events = [];
    this.nextSequence = 3;
  }

  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: this.conversationId,
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

function persistedUserInput(conversationId, sequence) {
  return Object.freeze({
    id: `input-agent-failure-${conversationId}-${sequence}`,
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    correlationId: `correlation-agent-failure-${conversationId}-${sequence}`,
    payload: Object.freeze({ text: "FORBIDDEN_FAILURE_INPUT_TEXT" }),
    direction: "input",
    sequence,
    recordedAt: timestamp,
  });
}

function runtimeUserMessage(conversationId, input) {
  return Object.freeze({
    id: `message-agent-failure-${conversationId}`,
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

async function runFailureScenario(phase) {
  const conversationId = `conversation-agent-failure-${phase}`;
  const runId = `run-agent-failure-${phase}`;
  const activeInput = persistedUserInput(conversationId, 1);
  const queuedInput = persistedUserInput(conversationId, 2);
  const logs = [];
  const logger = new CollectingLogger(logs);
  const eventSink = new RecordingSink(conversationId);
  const eventIdFactory = new IncrementingEventIdFactory(phase);
  const lifecycleController = new TurnController({
    conversationId,
    eventIdFactory,
    eventSink,
    runIdGenerator: Object.freeze({ generate: () => runId }),
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
  let preparationCount = 0;
  let assemblerCount = 0;
  let adapterCount = 0;
  const validPreparation = (request) => Object.freeze({
    conversationId,
    runId: request.runId,
    basePrompt: Object.freeze({
      content: "FORBIDDEN_FAILURE_SYSTEM_PROMPT FORBIDDEN_FAILURE_PATH",
      digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    messageHighWatermark: 0,
    contextMessages: Object.freeze([]),
    invocation: Object.freeze({
      kind: "prompt",
      messages: Object.freeze([runtimeUserMessage(conversationId, request.input)]),
    }),
  });
  const preparationSource = Object.freeze({
    prepare: async (request) => {
      preparationCount += 1;
      if (phase === "preparation") {
        throw new Error(
          "FORBIDDEN_FAILURE_PREPARATION_ERROR FORBIDDEN_FAILURE_PATH",
        );
      }
      return validPreparation(request);
    },
  });
  const assembler = Object.freeze({
    assemble: async () => {
      assemblerCount += 1;
      if (phase === "compiler") {
        throw new Error(
          "FORBIDDEN_FAILURE_ASSEMBLER_ERROR FORBIDDEN_FAILURE_PATH",
        );
      }
      return Object.freeze({
        systemPrompt:
          "FORBIDDEN_FAILURE_SYSTEM_PROMPT FORBIDDEN_FAILURE_PATH",
        messages: Object.freeze([]),
      });
    },
  });
  const adapter = Object.freeze({
    stream: async () => {
      adapterCount += 1;
      throw new Error(
        "FORBIDDEN_FAILURE_ADAPTER_ERROR FORBIDDEN_FAILURE_PATH",
      );
    },
    cancel: async () => undefined,
  });
  const runExecutor = new AgentRuntimeRunExecutor({
    conversationId,
    preparationSource,
    assembler,
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
  const pump = new RuntimeInputPump({
    conversationId,
    source: router,
    controlHandler: Object.freeze({ handle: async () => undefined }),
    turnHandler,
    clock: Object.freeze({ now: () => timestamp }),
    logger,
  });

  router.route(activeInput);
  router.route(queuedInput);
  pump.start();
  const exit = await pump.waitForExit();

  assert.deepEqual(exit, {
    kind: "failed",
    exitedAt: timestamp,
    scope: "turn",
    errorName: "RuntimeInputPumpFailureError",
    errorCode: "RUNTIME_INPUT_PUMP_FAILED",
    inputEventId: activeInput.id,
    eventType: activeInput.eventType,
    sequence: activeInput.sequence,
  });
  assert.equal(Object.isFrozen(exit), true);
  assert.equal(router.turnInbox.size, 1);
  assert.equal(router.turnInbox.peek().id, queuedInput.id);
  assert.equal(outcomeRecorder.hasCompleted(activeInput.id), true);
  assert.equal(outcomeRecorder.hasCompleted(queuedInput.id), false);
  assert.deepEqual(lifecycleController.getRunSnapshot(), {
    runId,
    inputEvent: {
      id: activeInput.id,
      eventType: activeInput.eventType,
      sequence: activeInput.sequence,
    },
    status: RUN_STATUS.running,
    reason: "execution_started",
    transitionOrdinal: 1,
  });
  assert.equal(lifecycleController.getTurnSnapshot(), undefined);
  assert.deepEqual(
    eventSink.events.map((event) => event.getEventType()),
    [
      OUTPUT_EVENT_TYPE.agentRunStateChanged,
      OUTPUT_EVENT_TYPE.runtimeInputProcessed,
      OUTPUT_EVENT_TYPE.agentRunStateChanged,
    ],
  );
  assert.equal(
    eventSink.events.some(
      (event) =>
        event.getEventType() === OUTPUT_EVENT_TYPE.agentRunStateChanged &&
        [RUN_STATUS.completed, RUN_STATUS.failed, RUN_STATUS.cancelled].includes(
          event.payload.current,
        ),
    ),
    false,
  );
  assert.equal(preparationCount, 1);
  assert.equal(assemblerCount, phase === "preparation" ? 0 : 1);
  assert.equal(adapterCount, phase === "adapter" ? 1 : 0);
  await pump.stop();

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
  return logs;
}

for (const phase of ["preparation", "compiler", "adapter"]) {
  await runFailureScenario(phase);
}

console.log("Task 3F-D Agent failure degradation integration smoke passed");
