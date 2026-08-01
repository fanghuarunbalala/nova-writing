import assert from "node:assert/strict";
import {
  AgentRunStateChangedOutputEvent,
  ConversationOutputConflictError,
  ConversationOutputPersistenceError,
  ConversationOutputRejectedError,
  OUTPUT_EVENT_TYPE,
  PublishingRuntimeEventSink,
  RUNTIME_EVENT_APPEND_FAILURE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  RuntimeEventAppendError,
  Sha256RuntimeEventIdFactory,
} from "../dist/index.js";
import { NodeSha256RuntimeEventIdHasher } from "../dist/node/index.js";

class CapturingHasher {
  algorithm = "sha256";
  inputs = [];

  digest(canonicalIdentity) {
    this.inputs.push(canonicalIdentity);
    return "a".repeat(64);
  }
}

class FakeOutputPublisher {
  constructor(results = []) {
    this.results = [...results];
    this.events = [];
  }

  async publish(event) {
    this.events.push(event);
    const result = this.results.shift();
    if (result instanceof Error) throw result;
    if (typeof result === "function") return result(event);
    return result;
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
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const capturingHasher = new CapturingHasher();
const capturingFactory = new Sha256RuntimeEventIdFactory({ hasher: capturingHasher });
assert.equal(
  capturingFactory.create({
    conversationId: "conversation-runtime-event",
    eventType: OUTPUT_EVENT_TYPE.agentTurnStateChanged,
    scope: "turn",
    runId: "run-runtime-event-1",
    turnId: "turn-runtime-event-1",
    ordinal: 3,
  }),
  `evt_rt_${"a".repeat(64)}`,
);
assert.deepEqual(JSON.parse(capturingHasher.inputs[0]), {
  conversationId: "conversation-runtime-event",
  eventType: "agent.turn.state.changed",
  namespace: "novel.runtime-event.v1",
  ordinal: 3,
  runId: "run-runtime-event-1",
  scope: "turn",
  turnId: "turn-runtime-event-1",
});
assert.equal(capturingHasher.inputs[0].includes("payload"), false);

const runtimeEventIdFactory = new Sha256RuntimeEventIdFactory({
  hasher: new NodeSha256RuntimeEventIdHasher(),
});
const runIdentity = {
  conversationId: "conversation-runtime-event",
  eventType: OUTPUT_EVENT_TYPE.agentRunStateChanged,
  scope: "run",
  runId: "run-runtime-event-1",
  ordinal: 0,
};
const stableRunEventId = runtimeEventIdFactory.create(runIdentity);
assert.match(stableRunEventId, /^evt_rt_[a-f0-9]{64}$/);
assert.equal(runtimeEventIdFactory.create({ ...runIdentity }), stableRunEventId);
assert.notEqual(
  runtimeEventIdFactory.create({ ...runIdentity, ordinal: 1 }),
  stableRunEventId,
);
assert.notEqual(
  runtimeEventIdFactory.create({
    conversationId: runIdentity.conversationId,
    eventType: runIdentity.eventType,
    scope: "input",
    inputEventId: "input-runtime-event-1",
    ordinal: 0,
  }),
  stableRunEventId,
);

for (const invalidIdentity of [
  { ...runIdentity, conversationId: " " },
  { ...runIdentity, eventType: "invalid" },
  { ...runIdentity, runId: "" },
  { ...runIdentity, ordinal: -1 },
  { ...runIdentity, ordinal: 1.5 },
]) {
  assert.throws(() => runtimeEventIdFactory.create(invalidIdentity), TypeError);
}
assert.throws(
  () =>
    new Sha256RuntimeEventIdFactory({
      hasher: {
        algorithm: "sha256",
        digest: () => "A".repeat(64),
      },
    }).create(runIdentity),
  TypeError,
);

const runEvent = new AgentRunStateChangedOutputEvent({
  conversationId: "conversation-runtime-event",
  id: stableRunEventId,
  timestamp: "2026-08-01T06:00:00.000Z",
  runId: "run-runtime-event-1",
  inputEvent: {
    id: "input-runtime-event-1",
    eventType: "user.message",
    sequence: 31,
  },
  previous: null,
  current: RUN_STATUS.queued,
  reason: RUN_STATE_CHANGE_REASON.inputQueued,
});
const logEntries = [];
const publisher = new FakeOutputPublisher([
  {
    status: "recorded",
    conversationId: runEvent.conversationId,
    outputEventId: runEvent.id,
    sequence: 32,
    recordedAt: "2026-08-01T06:00:01.000Z",
  },
  {
    status: "duplicate",
    conversationId: runEvent.conversationId,
    outputEventId: runEvent.id,
    sequence: 32,
    recordedAt: "2026-08-01T06:00:01.000Z",
  },
]);
const sink = new PublishingRuntimeEventSink({
  outputPublisher: publisher,
  logger: new CollectingLogger(logEntries),
});
const recordedReceipt = await sink.append(runEvent);
assert.deepEqual(recordedReceipt, {
  status: "recorded",
  conversationId: runEvent.conversationId,
  eventId: runEvent.id,
  sequence: 32,
  recordedAt: "2026-08-01T06:00:01.000Z",
});
assert.equal(Object.isFrozen(recordedReceipt), true);
const duplicateReceipt = await sink.append(runEvent);
assert.equal(duplicateReceipt.status, "duplicate");
assert.equal(duplicateReceipt.sequence, recordedReceipt.sequence);
assert.deepEqual(publisher.events, [runEvent, runEvent]);

const failureCases = [
  {
    error: new ConversationOutputRejectedError(
      runEvent.conversationId,
      runEvent.id,
      runEvent.getEventType(),
      "invalid_event",
    ),
    failure: RUNTIME_EVENT_APPEND_FAILURE.rejected,
  },
  {
    error: new ConversationOutputConflictError(
      runEvent.conversationId,
      runEvent.id,
      runEvent.getEventType(),
    ),
    failure: RUNTIME_EVENT_APPEND_FAILURE.conflict,
  },
  {
    error: new ConversationOutputPersistenceError(
      runEvent.conversationId,
      runEvent.id,
      runEvent.getEventType(),
      "SecretDatabaseError",
      "SECRET_DB_CODE",
    ),
    failure: RUNTIME_EVENT_APPEND_FAILURE.persistenceFailed,
  },
  {
    error: new Error("FORBIDDEN_RUNTIME_EVENT_RAW_ERROR"),
    failure: RUNTIME_EVENT_APPEND_FAILURE.publisherFailed,
  },
];

for (const { error, failure } of failureCases) {
  const failingSink = new PublishingRuntimeEventSink({
    outputPublisher: new FakeOutputPublisher([error]),
    logger: new CollectingLogger(logEntries),
  });
  await assert.rejects(
    () => failingSink.append(runEvent),
    (caught) =>
      caught instanceof RuntimeEventAppendError &&
      caught.failure === failure &&
      caught.eventId === runEvent.id,
  );
}

const invalidReceiptSink = new PublishingRuntimeEventSink({
  outputPublisher: new FakeOutputPublisher([
    {
      status: "recorded",
      conversationId: runEvent.conversationId,
      outputEventId: "different-event",
      sequence: 33,
      recordedAt: "2026-08-01T06:00:02.000Z",
    },
  ]),
  logger: new CollectingLogger(logEntries),
});
await assert.rejects(
  () => invalidReceiptSink.append(runEvent),
  (caught) =>
    caught instanceof RuntimeEventAppendError &&
    caught.failure === RUNTIME_EVENT_APPEND_FAILURE.invalidReceipt,
);

const serializedLogs = JSON.stringify(logEntries);
for (const forbidden of [
  "FORBIDDEN_RUNTIME_EVENT_RAW_ERROR",
  "SecretDatabaseError",
  "SECRET_DB_CODE",
  "payload",
  "stack",
  "cause",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(
  logEntries.some(
    (entry) =>
      entry.level === "debug" && entry.event === "runtime.event.append_started",
  ),
  true,
);
assert.equal(
  logEntries.some(
    (entry) =>
      entry.level === "info" && entry.event === "runtime.event.append_completed",
  ),
  true,
);

console.log("runtime event sink smoke passed");
