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
  ProjectedUserMessageRunPreparationSource,
  RUN_STATUS,
  RuntimeInputOutcomeController,
  RuntimeInputPump,
  RuntimeStopInputHandler,
  RuntimeUserMessageInputHandler,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";

const conversationId = "conversation-agent-no-process";
const timestamp = "2026-08-01T23:00:00.000Z";
const forbidden = [
  "FORBIDDEN_NO_PROCESS_PROMPT",
  "FORBIDDEN_NO_PROCESS_SYSTEM_PROMPT",
  "FORBIDDEN_NO_PROCESS_NOVEL_TEXT",
  "FORBIDDEN_NO_PROCESS_PATH",
];

class IncrementingEventIdFactory {
  count = 0;

  create(input) {
    this.count += 1;
    return `evt-no-process-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class RecordingSink {
  events = [];
  nextSequence = 2;

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

function persistedUserInput() {
  return Object.freeze({
    id: "input-agent-no-process-1",
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    correlationId: "correlation-agent-no-process-1",
    payload: Object.freeze({
      text: "FORBIDDEN_NO_PROCESS_PROMPT FORBIDDEN_NO_PROCESS_NOVEL_TEXT",
    }),
    direction: "input",
    sequence: 1,
    recordedAt: timestamp,
  });
}

function projectedUserMessage(input) {
  return Object.freeze({
    recordType: "message",
    conversationId,
    messageIndex: 1,
    source: Object.freeze({
      sequence: input.sequence,
      eventId: input.id,
      eventType: input.eventType,
      direction: input.direction,
      ordinal: 0,
    }),
    message: Object.freeze({
      id: "message-agent-no-process-1",
      conversationId,
      role: "user",
      messageType: "user.message",
      schemaVersion: 1,
      timestamp,
      payload: Object.freeze({
        content: Object.freeze([
          Object.freeze({
            type: "text",
            text: "FORBIDDEN_NO_PROCESS_PROMPT FORBIDDEN_NO_PROCESS_NOVEL_TEXT",
          }),
        ]),
      }),
    }),
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for no-process Agent integration");
}

const input = persistedUserInput();
const messageRecord = projectedUserMessage(input);
const logs = [];
const logger = new CollectingLogger(logs);
const eventSink = new RecordingSink();
const eventIdFactory = new IncrementingEventIdFactory();
const lifecycleController = new TurnController({
  conversationId,
  eventIdFactory,
  eventSink,
  runIdGenerator: Object.freeze({ generate: () => "run-agent-no-process-1" }),
  turnIdGenerator: Object.freeze({ generate: () => "turn-agent-no-process-1" }),
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
const preparationSource = new ProjectedUserMessageRunPreparationSource({
  conversationId,
  projections: Object.freeze({
    inspect: async () => {
      throw new Error("inspect is outside this smoke scope");
    },
    synchronize: async () => ({
      workspaceId: "workspace-agent-no-process",
      projectorId: "core.conversation-message",
      projectorVersion: "1",
      conversationId,
      operations: [],
      previousSequence: 1,
      projectedThroughSequence: 1,
      journalHighWatermark: 1,
      processedEventCount: 0,
      appendedMessageCount: 0,
    }),
    rebuild: async () => {
      throw new Error("rebuild is outside this smoke scope");
    },
  }),
  messages: Object.freeze({
    list: async (query) => ({
      conversationId,
      items:
        (query.afterMessageIndex ?? 0) < 1 &&
        (query.highWatermarkMessageIndex ?? 1) >= 1
          ? [messageRecord]
          : [],
      highWatermarkMessageIndex: 1,
      projectedThroughSequence: 1,
      hasMore: false,
    }),
  }),
  systemPromptSource: Object.freeze({
    resolve: async () =>
      "FORBIDDEN_NO_PROCESS_SYSTEM_PROMPT FORBIDDEN_NO_PROCESS_PATH",
  }),
  logger,
});

const adapterRequests = [];
const adapter = Object.freeze({
  stream: async (request) => {
    adapterRequests.push(request);
    await lifecycleController.beginTurn();
    await lifecycleController.transitionTurn({
      current: TURN_STATUS.completed,
      reason: TURN_STATE_CHANGE_REASON.turnCompleted,
    });
    return Object.freeze({
      conversationId,
      runId: request.runId,
      outcome: AGENT_RUNTIME_OUTCOME.completed,
    });
  },
  cancel: async (request) => {
    assert.equal(request.reason, EXECUTION_CANCELLATION_REASON.stop);
  },
});
const runExecutor = new AgentRuntimeRunExecutor({
  conversationId,
  preparationSource,
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

assert.deepEqual(router.route(input), {
  status: "enqueued",
  lane: "turn",
  sequence: 1,
});
pump.start();
await waitFor(
  () =>
    lifecycleController.getRunSnapshot()?.status === RUN_STATUS.completed &&
    lifecycleController.getTurnSnapshot()?.status === TURN_STATUS.completed,
);
await pump.stop();
assert.deepEqual(await pump.waitForExit(), {
  kind: "stopped",
  exitedAt: timestamp,
});

assert.equal(adapterRequests.length, 1);
assert.equal(adapterRequests[0].conversationId, conversationId);
assert.equal(adapterRequests[0].runId, "run-agent-no-process-1");
assert.equal(
  adapterRequests[0].context.systemPrompt,
  "FORBIDDEN_NO_PROCESS_SYSTEM_PROMPT FORBIDDEN_NO_PROCESS_PATH",
);
assert.deepEqual(adapterRequests[0].context.messages, []);
assert.equal(adapterRequests[0].invocation.kind, "prompt");
assert.equal(adapterRequests[0].invocation.messages.length, 1);
assert.equal(
  adapterRequests[0].invocation.messages[0].payload.content[0].text,
  "FORBIDDEN_NO_PROCESS_PROMPT FORBIDDEN_NO_PROCESS_NOVEL_TEXT",
);

assert.deepEqual(lifecycleController.getRunSnapshot(), {
  runId: "run-agent-no-process-1",
  inputEvent: {
    id: input.id,
    eventType: input.eventType,
    sequence: input.sequence,
  },
  status: RUN_STATUS.completed,
  reason: "execution_completed",
  transitionOrdinal: 2,
});
assert.deepEqual(lifecycleController.getTurnSnapshot(), {
  runId: "run-agent-no-process-1",
  turnId: "turn-agent-no-process-1",
  status: TURN_STATUS.completed,
  reason: "turn_completed",
  transitionOrdinal: 1,
});
assert.equal(outcomeRecorder.hasCompleted(input.id), true);
assert.deepEqual(
  eventSink.events.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.runtimeInputProcessed,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
    OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    OUTPUT_EVENT_TYPE.agentRunStateChanged,
  ],
);

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some((entry) => entry.event === "runtime.input_pump.turn_completed"),
  true,
);
assert.equal(
  logs.some((entry) => entry.event === "runtime.agent_run.execution_completed"),
  true,
);

console.log("Task 3F-A no-process Agent Runtime integration smoke passed");
