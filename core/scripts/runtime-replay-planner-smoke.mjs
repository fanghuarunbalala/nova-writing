import assert from "node:assert/strict";
import {
  AgentRunStateChangedOutputEvent,
  AgentTurnStateChangedOutputEvent,
  createCoreEventSchemaRegistry,
  HOST_INPUT_HANDLER,
  HOST_INPUT_ROUTING_OUTCOME,
  HostInputRoutedOutputEvent,
  JournalRuntimeReplayPlanner,
  OUTPUT_EVENT_TYPE,
  RUNTIME_INPUT_PROCESSING_OUTCOME,
  RUNTIME_REPLAY_PLANNING_FAILURE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RuntimeInputProcessedOutputEvent,
  RuntimeReplayPlanningError,
  Sha256RuntimeEventIdFactory,
  StopInputEvent,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  UserMessageInputEvent,
} from "../dist/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../dist/node/index.js";

class FakeJournal {
  constructor(events, options = {}) {
    this.events = events;
    this.highWatermark = options.highWatermark ?? events.at(-1)?.sequence ?? 0;
    this.failure = options.failure;
    this.requests = [];
  }

  async list(query) {
    this.requests.push(query);
    if (this.failure) throw this.failure;
    const afterSequence = "afterSequence" in query.anchor ? query.anchor.afterSequence : 0;
    const throughSequence = Math.min(
      this.highWatermark,
      query.throughSequence ?? this.highWatermark,
    );
    const matching = this.events.filter(
      (event) => event.sequence > afterSequence && event.sequence <= throughSequence,
    );
    const events = matching.slice(0, query.limit);
    return {
      events,
      highWatermark: throughSequence,
      hasPrevious: afterSequence > 0,
      hasNext: matching.length > events.length,
    };
  }

  async getHighWatermark() { return this.highWatermark; }
  async getBySequence(conversationId, sequence) {
    return this.events.find(
      (event) => event.conversationId === conversationId && event.sequence === sequence,
    );
  }
  async getByEventId(conversationId, eventId) {
    return this.events.find(
      (event) => event.conversationId === conversationId && event.id === eventId,
    );
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

const conversationId = "conversation-replay";
const timestamp = "2026-08-01T10:00:00.000Z";
const recordedAt = "2026-08-01T10:00:01.000Z";
const secret = "FORBIDDEN_REPLAY_NOVEL_TEXT";
const eventIdFactory = new Sha256RuntimeEventIdFactory({
  hasher: new NodeSha256RuntimeEventIdHasher(),
});

const firstInput = new UserMessageInputEvent({
  id: "input-replay-1",
  conversationId,
  timestamp,
  text: "first message",
});
const secondInput = new UserMessageInputEvent({
  id: "input-replay-2",
  conversationId,
  timestamp,
  text: secret,
});
const stopInput = new StopInputEvent({
  id: "input-replay-stop",
  conversationId,
  timestamp,
});
const firstReference = {
  id: firstInput.id,
  eventType: firstInput.getEventType(),
  sequence: 1,
};
const secondReference = {
  id: secondInput.id,
  eventType: secondInput.getEventType(),
  sequence: 10,
};
const stopReference = {
  id: stopInput.id,
  eventType: stopInput.getEventType(),
  sequence: 8,
};

function runtimeEventId(scope, eventType, ordinal, identity) {
  return eventIdFactory.create({
    scope,
    conversationId,
    eventType,
    ordinal,
    ...identity,
  });
}

function persistInput(input, sequence) {
  return {
    ...input.getSnapshot(),
    direction: "input",
    sequence,
    recordedAt,
  };
}

function persistOutput(output, sequence) {
  return {
    ...output.getSnapshot(),
    direction: "output",
    sequence,
    recordedAt,
  };
}

const events = [
  persistInput(firstInput, 1),
  persistOutput(
    new RuntimeInputProcessedOutputEvent({
      id: runtimeEventId("input", OUTPUT_EVENT_TYPE.runtimeInputProcessed, 0, {
        inputEventId: firstInput.id,
      }),
      conversationId,
      timestamp,
      inputEvent: firstReference,
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
    }),
    2,
  ),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 0, {
        runId: "run-replay-1",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-1",
      inputEvent: firstReference,
      previous: null,
      current: RUN_STATUS.queued,
      reason: RUN_STATE_CHANGE_REASON.inputQueued,
    }),
    3,
  ),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 1, {
        runId: "run-replay-1",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-1",
      inputEvent: firstReference,
      previous: RUN_STATUS.queued,
      current: RUN_STATUS.running,
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    }),
    4,
  ),
  persistOutput(
    new AgentTurnStateChangedOutputEvent({
      id: runtimeEventId("turn", OUTPUT_EVENT_TYPE.agentTurnStateChanged, 0, {
        runId: "run-replay-1",
        turnId: "turn-replay-1",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-1",
      turnId: "turn-replay-1",
      previous: null,
      current: TURN_STATUS.running,
      reason: TURN_STATE_CHANGE_REASON.providerStarted,
    }),
    5,
  ),
  persistOutput(
    new AgentTurnStateChangedOutputEvent({
      id: runtimeEventId("turn", OUTPUT_EVENT_TYPE.agentTurnStateChanged, 1, {
        runId: "run-replay-1",
        turnId: "turn-replay-1",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-1",
      turnId: "turn-replay-1",
      previous: TURN_STATUS.running,
      current: TURN_STATUS.completed,
      reason: TURN_STATE_CHANGE_REASON.turnCompleted,
    }),
    6,
  ),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 2, {
        runId: "run-replay-1",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-1",
      inputEvent: firstReference,
      previous: RUN_STATUS.running,
      current: RUN_STATUS.completed,
      reason: RUN_STATE_CHANGE_REASON.executionCompleted,
    }),
    7,
  ),
  persistInput(stopInput, 8),
  persistOutput(
    new HostInputRoutedOutputEvent({
      id: "host-routed-stop-no-runtime",
      conversationId,
      timestamp,
      inputEvent: stopReference,
      handler: HOST_INPUT_HANDLER.stop,
      outcome: HOST_INPUT_ROUTING_OUTCOME.noRuntime,
    }),
    9,
  ),
  persistInput(secondInput, 10),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 0, {
        runId: "run-replay-2",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-2",
      inputEvent: secondReference,
      previous: null,
      current: RUN_STATUS.queued,
      reason: RUN_STATE_CHANGE_REASON.inputQueued,
    }),
    11,
  ),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 1, {
        runId: "run-replay-2",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-2",
      inputEvent: secondReference,
      previous: RUN_STATUS.queued,
      current: RUN_STATUS.running,
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    }),
    12,
  ),
  persistOutput(
    new AgentTurnStateChangedOutputEvent({
      id: runtimeEventId("turn", OUTPUT_EVENT_TYPE.agentTurnStateChanged, 0, {
        runId: "run-replay-2",
        turnId: "turn-replay-2",
      }),
      conversationId,
      timestamp,
      runId: "run-replay-2",
      turnId: "turn-replay-2",
      previous: null,
      current: TURN_STATUS.running,
      reason: TURN_STATE_CHANGE_REASON.providerStarted,
    }),
    13,
  ),
];

const logs = [];
const journal = new FakeJournal(events);
const planner = new JournalRuntimeReplayPlanner({
  journal,
  eventSchemaRegistry: createCoreEventSchemaRegistry(),
  eventIdFactory,
  pageSize: 3,
  logger: new CollectingLogger(logs),
});
const plan = await planner.plan({ conversationId, throughSequence: 13 });

assert.equal(plan.scannedEventCount, 13);
assert.equal(plan.processedInputCount, 1);
assert.deepEqual(plan.pendingInputs.map((input) => input.id), [stopInput.id, secondInput.id]);
assert.deepEqual(plan.run, {
  runId: "run-replay-2",
  inputEvent: secondReference,
  status: RUN_STATUS.running,
  reason: RUN_STATE_CHANGE_REASON.executionStarted,
  transitionOrdinal: 1,
});
assert.deepEqual(plan.turn, {
  runId: "run-replay-2",
  turnId: "turn-replay-2",
  status: TURN_STATUS.running,
  reason: TURN_STATE_CHANGE_REASON.providerStarted,
  transitionOrdinal: 0,
});
assert.equal(journal.requests.length, 5);
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.pendingInputs), true);
assert.equal(Object.isFrozen(plan.pendingInputs[0]), true);
assert.equal(Object.isFrozen(plan.pendingInputs[0].payload), true);
events[9].payload.text = "mutated-after-plan";
assert.equal(plan.pendingInputs[1].payload.text, secret);

const emptyJournal = new FakeJournal([]);
const emptyPlan = await new JournalRuntimeReplayPlanner({
  journal: emptyJournal,
  eventSchemaRegistry: createCoreEventSchemaRegistry(),
  eventIdFactory,
}).plan({ conversationId, throughSequence: 0 });
assert.equal(emptyPlan.scannedEventCount, 0);
assert.equal(emptyPlan.pendingInputs.length, 0);
assert.equal(emptyJournal.requests.length, 0);

async function expectFailure(candidateEvents, request, failure, options = {}) {
  const candidateLogs = [];
  const candidate = new JournalRuntimeReplayPlanner({
    journal: new FakeJournal(candidateEvents, options),
    eventSchemaRegistry: createCoreEventSchemaRegistry(),
    eventIdFactory,
    pageSize: 3,
    logger: new CollectingLogger(candidateLogs),
  });
  await assert.rejects(
    () => candidate.plan(request),
    (error) => error instanceof RuntimeReplayPlanningError && error.failure === failure,
  );
  return candidateLogs;
}

await expectFailure(
  events,
  { conversationId, throughSequence: -1 },
  RUNTIME_REPLAY_PLANNING_FAILURE.invalidRequest,
);
const readFailureLogs = await expectFailure(
  events,
  { conversationId, throughSequence: 13 },
  RUNTIME_REPLAY_PLANNING_FAILURE.readFailed,
  { failure: new Error("FORBIDDEN_REPLAY_RAW_ERROR") },
);
await expectFailure(
  events,
  { conversationId, throughSequence: 13 },
  RUNTIME_REPLAY_PLANNING_FAILURE.watermarkMismatch,
  { highWatermark: 12 },
);
await expectFailure(
  events.filter((event) => event.sequence !== 5),
  { conversationId, throughSequence: 13 },
  RUNTIME_REPLAY_PLANNING_FAILURE.journalGap,
  { highWatermark: 13 },
);
await expectFailure(
  events.map((event) =>
    event.sequence === 1 ? { ...event, priority: 123 } : event,
  ),
  { conversationId, throughSequence: 13 },
  RUNTIME_REPLAY_PLANNING_FAILURE.invalidEvent,
);
await expectFailure(
  events.map((event) =>
    event.sequence === 12 ? { ...event, id: "invalid-runtime-event-id" } : event,
  ),
  { conversationId, throughSequence: 13 },
  RUNTIME_REPLAY_PLANNING_FAILURE.historyConflict,
);

const serializedLogs = JSON.stringify([...logs, ...readFailureLogs]);
for (const forbidden of [
  secret,
  "FORBIDDEN_REPLAY_RAW_ERROR",
  "payload",
  "stack",
  "cause",
  "path",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(logs.some((entry) => entry.event === "runtime.replay.planned"), true);
assert.equal(
  readFailureLogs.some(
    (entry) =>
      entry.event === "runtime.replay.plan_failed" &&
      entry.fields.failure === RUNTIME_REPLAY_PLANNING_FAILURE.readFailed,
  ),
  true,
);

console.log("runtime replay planner smoke passed");
