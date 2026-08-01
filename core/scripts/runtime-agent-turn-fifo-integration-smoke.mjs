import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_OUTCOME,
  AgentRuntimeRunExecutor,
  BaseContextCompiler,
  INPUT_EVENT_TYPE,
  InputRouter,
  OUTPUT_EVENT_TYPE,
  ProjectedUserMessageRunPreparationSource,
  RUN_STATUS,
  RuntimeInputOutcomeController,
  RuntimeInputPump,
  RuntimeUserMessageInputHandler,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";

const conversationId = "conversation-agent-turn-fifo";
const timestamp = "2026-08-01T23:10:00.000Z";
const forbidden = [
  "FORBIDDEN_FIFO_FIRST_TEXT",
  "FORBIDDEN_FIFO_SECOND_TEXT",
  "FORBIDDEN_FIFO_SYSTEM_PROMPT",
  "FORBIDDEN_FIFO_PATH",
];

class IncrementingEventIdFactory {
  count = 0;

  create(input) {
    this.count += 1;
    return `evt-turn-fifo-${input.scope}-${input.ordinal}-${this.count}`;
  }
}

class SequenceIdGenerator {
  constructor(prefix) {
    this.prefix = prefix;
    this.count = 0;
  }

  generate() {
    this.count += 1;
    return `${this.prefix}-${this.count}`;
  }
}

class RecordingSink {
  events = [];
  nextSequence = 3;

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

function persistedUserInput(sequence, text) {
  return Object.freeze({
    id: `input-agent-turn-fifo-${sequence}`,
    conversationId,
    eventType: INPUT_EVENT_TYPE.userMessage,
    schemaVersion: 1,
    priority: 500,
    timestamp,
    correlationId: `correlation-agent-turn-fifo-${sequence}`,
    payload: Object.freeze({ text }),
    direction: "input",
    sequence,
    recordedAt: timestamp,
  });
}

function messageRecord(input, messageIndex, text) {
  return Object.freeze({
    recordType: "message",
    conversationId,
    messageIndex,
    source: Object.freeze({
      sequence: input.sequence,
      eventId: input.id,
      eventType: input.eventType,
      direction: input.direction,
      ordinal: 0,
    }),
    message: Object.freeze({
      id: `message-agent-turn-fifo-${messageIndex}`,
      conversationId,
      role: "user",
      messageType: "user.message",
      schemaVersion: 1,
      timestamp,
      payload: Object.freeze({
        content: Object.freeze([Object.freeze({ type: "text", text })]),
      }),
    }),
  });
}

function fakeMessageStore(records) {
  return Object.freeze({
    list: async (query) => {
      const highWatermarkMessageIndex = query.highWatermarkMessageIndex ?? records.length;
      const matching = records.filter(
        (record) =>
          record.messageIndex > (query.afterMessageIndex ?? 0) &&
          record.messageIndex <= highWatermarkMessageIndex,
      );
      const items = matching.slice(0, query.limit);
      const hasMore = matching.length > items.length;
      return {
        conversationId,
        items,
        highWatermarkMessageIndex,
        projectedThroughSequence: 2,
        hasMore,
        ...(hasMore
          ? { nextAfterMessageIndex: items.at(-1).messageIndex }
          : {}),
      };
    },
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for Agent Turn FIFO integration");
}

const firstInput = persistedUserInput(1, "FORBIDDEN_FIFO_FIRST_TEXT");
const secondInput = persistedUserInput(2, "FORBIDDEN_FIFO_SECOND_TEXT");
const records = [
  messageRecord(firstInput, 1, "FORBIDDEN_FIFO_FIRST_TEXT"),
  messageRecord(secondInput, 2, "FORBIDDEN_FIFO_SECOND_TEXT"),
];
const logs = [];
const logger = new CollectingLogger(logs);
const eventSink = new RecordingSink();
const eventIdFactory = new IncrementingEventIdFactory();
const lifecycleController = new TurnController({
  conversationId,
  eventIdFactory,
  eventSink,
  runIdGenerator: new SequenceIdGenerator("run-agent-turn-fifo"),
  turnIdGenerator: new SequenceIdGenerator("turn-agent-turn-fifo"),
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
      workspaceId: "workspace-agent-turn-fifo",
      projectorId: "core.conversation-message",
      projectorVersion: "1",
      conversationId,
      operations: [],
      previousSequence: 2,
      projectedThroughSequence: 2,
      journalHighWatermark: 2,
      processedEventCount: 0,
      appendedMessageCount: 0,
    }),
    rebuild: async () => {
      throw new Error("rebuild is outside this smoke scope");
    },
  }),
  messages: fakeMessageStore(records),
  systemPromptSource: Object.freeze({
    resolve: async () => "FORBIDDEN_FIFO_SYSTEM_PROMPT FORBIDDEN_FIFO_PATH",
  }),
  pageSize: 1,
  logger,
});

const firstAdapterGate = deferred();
const adapterRequests = [];
const executionOrder = [];
const adapter = Object.freeze({
  stream: async (request) => {
    adapterRequests.push(request);
    executionOrder.push(`stream-start:${request.runId}`);
    const turn = await lifecycleController.beginTurn();
    executionOrder.push(`turn-start:${turn.transition.turnId}`);
    if (request.runId === "run-agent-turn-fifo-1") {
      await firstAdapterGate.promise;
    }
    await lifecycleController.transitionTurn({
      current: TURN_STATUS.completed,
      reason: TURN_STATE_CHANGE_REASON.turnCompleted,
    });
    executionOrder.push(`stream-end:${request.runId}`);
    return Object.freeze({
      conversationId,
      runId: request.runId,
      outcome: AGENT_RUNTIME_OUTCOME.completed,
    });
  },
  cancel: async () => undefined,
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
const pump = new RuntimeInputPump({
  conversationId,
  source: router,
  controlHandler: Object.freeze({
    handle: async () => {
      throw new Error("Control execution is outside Task 3F-B");
    },
  }),
  turnHandler,
  clock: Object.freeze({ now: () => timestamp }),
  logger,
});

router.route(firstInput);
router.route(secondInput);
pump.start();
await waitFor(() => adapterRequests.length === 1);
assert.equal(router.turnInbox.size, 1);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(adapterRequests.length, 1);
assert.equal(lifecycleController.getRunSnapshot().runId, "run-agent-turn-fifo-1");
assert.equal(lifecycleController.getRunSnapshot().status, RUN_STATUS.running);

firstAdapterGate.resolve();
await waitFor(
  () =>
    adapterRequests.length === 2 &&
    lifecycleController.getRunSnapshot()?.runId === "run-agent-turn-fifo-2" &&
    lifecycleController.getRunSnapshot()?.status === RUN_STATUS.completed,
);
await pump.stop();
assert.equal(outcomeRecorder.hasCompleted(firstInput.id), true);
assert.equal(outcomeRecorder.hasCompleted(secondInput.id), true);
assert.equal(router.turnInbox.size, 0);

assert.deepEqual(executionOrder, [
  "stream-start:run-agent-turn-fifo-1",
  "turn-start:turn-agent-turn-fifo-1",
  "stream-end:run-agent-turn-fifo-1",
  "stream-start:run-agent-turn-fifo-2",
  "turn-start:turn-agent-turn-fifo-2",
  "stream-end:run-agent-turn-fifo-2",
]);
assert.equal(adapterRequests[0].context.messages.length, 0);
assert.equal(adapterRequests[0].invocation.messages[0].id, records[0].message.id);
assert.equal(adapterRequests[1].context.messages.length, 1);
assert.equal(adapterRequests[1].context.messages[0].id, records[0].message.id);
assert.equal(adapterRequests[1].invocation.messages[0].id, records[1].message.id);

const runTransitions = eventSink.events
  .filter((event) => event.getEventType() === OUTPUT_EVENT_TYPE.agentRunStateChanged)
  .map((event) => {
    const snapshot = event.getSnapshot();
    return `${snapshot.runId}:${snapshot.payload.current}`;
  });
assert.deepEqual(runTransitions, [
  "run-agent-turn-fifo-1:queued",
  "run-agent-turn-fifo-1:running",
  "run-agent-turn-fifo-1:completed",
  "run-agent-turn-fifo-2:queued",
  "run-agent-turn-fifo-2:running",
  "run-agent-turn-fifo-2:completed",
]);

const firstCompletedIndex = runTransitions.indexOf(
  "run-agent-turn-fifo-1:completed",
);
const secondQueuedIndex = runTransitions.indexOf("run-agent-turn-fifo-2:queued");
assert.equal(firstCompletedIndex < secondQueuedIndex, true);

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.filter((entry) => entry.event === "runtime.input_pump.turn_completed").length,
  2,
);

console.log("Task 3F-B Agent Turn FIFO integration smoke passed");
