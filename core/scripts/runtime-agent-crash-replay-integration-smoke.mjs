import assert from "node:assert/strict";
import {
  AgentRunStateChangedOutputEvent,
  createCoreEventSchemaRegistry,
  INPUT_EVENT_TYPE,
  JournalRuntimeReplayPlanner,
  OUTPUT_EVENT_TYPE,
  RUNTIME_INPUT_PROCESSING_OUTCOME,
  RUNTIME_STARTUP_LIFECYCLE_DISPOSITION,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RuntimeInputProcessedOutputEvent,
  RuntimeStartupReconciler,
  Sha256RuntimeEventIdFactory,
  UserMessageInputEvent,
} from "../dist/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../dist/node/index.js";

const conversationId = "conversation-agent-crash-replay";
const runId = "run-agent-crash-replay-1";
const timestamp = "2026-08-01T23:50:00.000Z";
const recordedAt = "2026-08-01T23:50:01.000Z";
const forbidden = [
  "FORBIDDEN_CRASH_REPLAY_NOVEL_TEXT",
  "FORBIDDEN_CRASH_REPLAY_PROMPT",
  "FORBIDDEN_CRASH_REPLAY_PATH",
];

class FakeJournal {
  constructor(events) {
    this.events = events;
    this.highWatermark = events.at(-1)?.sequence ?? 0;
    this.requests = [];
  }

  async list(query) {
    this.requests.push(query);
    const afterSequence = "afterSequence" in query.anchor
      ? query.anchor.afterSequence
      : 0;
    const throughSequence = query.throughSequence ?? this.highWatermark;
    const matching = this.events.filter(
      (event) =>
        event.sequence > afterSequence && event.sequence <= throughSequence,
    );
    const events = matching.slice(0, query.limit);
    return {
      events,
      highWatermark: throughSequence,
      hasPrevious: afterSequence > 0,
      hasNext: matching.length > events.length,
    };
  }

  async getHighWatermark() {
    return this.highWatermark;
  }

  async getBySequence(candidateConversationId, sequence) {
    return this.events.find(
      (event) =>
        event.conversationId === candidateConversationId &&
        event.sequence === sequence,
    );
  }

  async getByEventId(candidateConversationId, eventId) {
    return this.events.find(
      (event) =>
        event.conversationId === candidateConversationId && event.id === eventId,
    );
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

const eventIdFactory = new Sha256RuntimeEventIdFactory({
  hasher: new NodeSha256RuntimeEventIdHasher(),
});
const input = new UserMessageInputEvent({
  id: "input-agent-crash-replay-1",
  conversationId,
  timestamp,
  text: "FORBIDDEN_CRASH_REPLAY_NOVEL_TEXT",
});
const inputReference = Object.freeze({
  id: input.id,
  eventType: INPUT_EVENT_TYPE.userMessage,
  sequence: 1,
});

function runtimeEventId(scope, eventType, ordinal, identity) {
  return eventIdFactory.create({
    scope,
    conversationId,
    eventType,
    ordinal,
    ...identity,
  });
}

function persistInput(event, sequence) {
  return Object.freeze({
    ...event.getSnapshot(),
    direction: "input",
    sequence,
    recordedAt,
  });
}

function persistOutput(event, sequence) {
  return Object.freeze({
    ...event.getSnapshot(),
    direction: "output",
    sequence,
    recordedAt,
  });
}

const events = Object.freeze([
  persistInput(input, 1),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 0, {
        runId,
      }),
      conversationId,
      timestamp,
      runId,
      inputEvent: inputReference,
      previous: null,
      current: RUN_STATUS.queued,
      reason: RUN_STATE_CHANGE_REASON.inputQueued,
    }),
    2,
  ),
  persistOutput(
    new RuntimeInputProcessedOutputEvent({
      id: runtimeEventId("input", OUTPUT_EVENT_TYPE.runtimeInputProcessed, 0, {
        inputEventId: input.id,
      }),
      conversationId,
      timestamp,
      inputEvent: inputReference,
      outcome: RUNTIME_INPUT_PROCESSING_OUTCOME.consumed,
      runId,
    }),
    3,
  ),
  persistOutput(
    new AgentRunStateChangedOutputEvent({
      id: runtimeEventId("run", OUTPUT_EVENT_TYPE.agentRunStateChanged, 1, {
        runId,
      }),
      conversationId,
      timestamp,
      runId,
      inputEvent: inputReference,
      previous: RUN_STATUS.queued,
      current: RUN_STATUS.running,
      reason: RUN_STATE_CHANGE_REASON.executionStarted,
    }),
    4,
  ),
]);

const logs = [];
const journal = new FakeJournal(events);
const replay = await new JournalRuntimeReplayPlanner({
  journal,
  eventSchemaRegistry: createCoreEventSchemaRegistry(),
  eventIdFactory,
  pageSize: 2,
  logger: new CollectingLogger(logs),
}).plan({ conversationId, throughSequence: 4 });

assert.equal(replay.scannedEventCount, 4);
assert.equal(replay.processedInputCount, 1);
assert.deepEqual(replay.pendingInputs, []);
assert.deepEqual(replay.unconfirmedRunInputs, []);
assert.deepEqual(replay.run, {
  runId,
  inputEvent: inputReference,
  status: RUN_STATUS.running,
  reason: RUN_STATE_CHANGE_REASON.executionStarted,
  transitionOrdinal: 1,
});
assert.equal(replay.turn, undefined);
assert.equal(journal.requests.length, 2);

const startup = new RuntimeStartupReconciler({
  logger: new CollectingLogger(logs),
}).reconcile(replay);
assert.equal(
  startup.lifecycleDisposition,
  RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.recoveryRequired,
);
assert.deepEqual(startup.outcomeRepairs, []);
assert.deepEqual(startup.routableInputs, []);
assert.deepEqual(startup.run, replay.run);
assert.equal(startup.turn, undefined);
assert.equal(Object.isFrozen(startup), true);
assert.equal(Object.isFrozen(startup.outcomeRepairs), true);
assert.equal(Object.isFrozen(startup.routableInputs), true);

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.replay.planned" &&
      entry.fields.runStatus === RUN_STATUS.running,
  ),
  true,
);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.startup.reconciled" &&
      entry.fields.lifecycleDisposition ===
        RUNTIME_STARTUP_LIFECYCLE_DISPOSITION.recoveryRequired,
  ),
  true,
);

console.log("Task 3F-F Agent crash replay detection smoke passed");
