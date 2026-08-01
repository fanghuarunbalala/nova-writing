import assert from "node:assert/strict";
import {
  CoreConversationHostControlDispatcher,
  ConversationHostSignalInvalidError,
  ConversationRuntimeDispatchError,
  HOST_INPUT_ROUTING_OUTCOME,
} from "../dist/index.js";

class FixedClock {
  now() {
    return "2026-08-01T01:00:00.000Z";
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

class FakeOutputPublisher {
  constructor() {
    this.events = [];
    this.nextSequence = 101;
    this.failuresRemaining = 0;
  }

  async publish(event) {
    const snapshot = event.getSnapshot();
    this.events.push(snapshot);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      const error = new Error("FORBIDDEN_ROUTING_OUTPUT_FAILURE");
      error.code = "ROUTING_OUTPUT_FAILED";
      throw error;
    }
    return Object.freeze({
      status: "recorded",
      conversationId: snapshot.conversationId,
      outputEventId: snapshot.id,
      sequence: this.nextSequence++,
      recordedAt: snapshot.timestamp,
    });
  }
}

class FakeRuntimeTarget {
  constructor(conversationId = "conversation-control-dispatcher") {
    this.conversationId = conversationId;
    this.runtimeInstanceId = "rt_control_dispatcher";
    this.inputs = [];
    this.failuresRemaining = 0;
  }

  async dispatchInput(input) {
    this.inputs.push(input);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      const error = new Error("FORBIDDEN_RUNTIME_NOTIFICATION_FAILURE");
      error.code = "RUNTIME_NOTIFICATION_FAILED";
      throw error;
    }
  }
}

function createSignal({ sequence, handler, eventType, ...metadata }) {
  return Object.freeze({
    conversationId: "conversation-control-dispatcher",
    inputEventId: `input-control-${sequence}`,
    eventType,
    priority: 1_000,
    sequence,
    recordedAt: "2026-08-01T00:00:00.000Z",
    journalStatus: "appended",
    route: Object.freeze({
      target: "host",
      handler,
      runtimeNotification: "if_online",
    }),
    ...metadata,
  });
}

function createPresence(state) {
  return Object.freeze({
    state,
    observedAt: "2026-08-01T00:30:00.000Z",
  });
}

const logger = new CollectingLogger();
const outputPublisher = new FakeOutputPublisher();
const dispatcher = new CoreConversationHostControlDispatcher({
  outputPublisher,
  clock: new FixedClock(),
  logger,
});

const onlineRuntime = new FakeRuntimeTarget();
const stopSignal = createSignal({
  sequence: 1,
  handler: "stop",
  eventType: "system.stop",
  correlationId: "correlation-stop",
  runId: "run-stop",
  turnId: "turn-stop",
});
const stopResult = await dispatcher.dispatch(stopSignal, {
  presence: createPresence("online"),
  runtime: onlineRuntime,
});
assert.equal(Object.isFrozen(stopResult), true);
assert.equal(stopResult.handler, "stop");
assert.equal(stopResult.outcome, HOST_INPUT_ROUTING_OUTCOME.runtimeNotified);
assert.deepEqual(onlineRuntime.inputs, [
  {
    conversationId: "conversation-control-dispatcher",
    inputEventId: "input-control-1",
    eventType: "system.stop",
    sequence: 1,
    correlationId: "correlation-stop",
    runId: "run-stop",
    turnId: "turn-stop",
  },
]);
assert.deepEqual(outputPublisher.events[0], {
  id: outputPublisher.events[0].id,
  conversationId: "conversation-control-dispatcher",
  eventType: "system.input.routed",
  schemaVersion: 1,
  timestamp: "2026-08-01T01:00:00.000Z",
  correlationId: "correlation-stop",
  causationId: "input-control-1",
  runId: "run-stop",
  turnId: "turn-stop",
  payload: {
    handler: "stop",
    outcome: "runtime_notified",
  },
  inputEvent: {
    id: "input-control-1",
    eventType: "system.stop",
    sequence: 1,
  },
});

const offlineStop = await dispatcher.dispatch(
  createSignal({ sequence: 2, handler: "stop", eventType: "system.stop" }),
  { presence: createPresence("offline") },
);
assert.equal(offlineStop.outcome, HOST_INPUT_ROUTING_OUTCOME.noRuntime);
assert.equal(outputPublisher.events.at(-1).payload.outcome, "no_runtime");

const offlineReload = await dispatcher.dispatch(
  createSignal({
    sequence: 3,
    handler: "reload_config",
    eventType: "command.config.reload",
  }),
  { presence: createPresence("crashed") },
);
assert.equal(offlineReload.outcome, HOST_INPUT_ROUTING_OUTCOME.deferred);
assert.equal(outputPublisher.events.at(-1).payload.outcome, "deferred");

const reloadRuntime = new FakeRuntimeTarget();
const onlineReload = await dispatcher.dispatch(
  createSignal({
    sequence: 4,
    handler: "reload_config",
    eventType: "command.config.reload",
  }),
  { presence: createPresence("online"), runtime: reloadRuntime },
);
assert.equal(onlineReload.outcome, HOST_INPUT_ROUTING_OUTCOME.runtimeNotified);
assert.equal(reloadRuntime.inputs[0].eventType, "command.config.reload");

const failingRuntime = new FakeRuntimeTarget();
failingRuntime.failuresRemaining = 1;
const outputCountBeforeRuntimeFailure = outputPublisher.events.length;
await assert.rejects(
  dispatcher.dispatch(
    createSignal({ sequence: 5, handler: "stop", eventType: "system.stop" }),
    { presence: createPresence("online"), runtime: failingRuntime },
  ),
  (error) =>
    error instanceof ConversationRuntimeDispatchError &&
    error.errorCode === "RUNTIME_NOTIFICATION_FAILED",
);
assert.equal(outputPublisher.events.length, outputCountBeforeRuntimeFailure);

const outputFailureRuntime = new FakeRuntimeTarget();
outputPublisher.failuresRemaining = 1;
await assert.rejects(
  dispatcher.dispatch(
    createSignal({ sequence: 6, handler: "stop", eventType: "system.stop" }),
    { presence: createPresence("online"), runtime: outputFailureRuntime },
  ),
  (error) => error.code === "ROUTING_OUTPUT_FAILED",
);
assert.equal(outputFailureRuntime.inputs.length, 1);
assert.equal(outputPublisher.events.at(-1).inputEvent.sequence, 6);

await assert.rejects(
  dispatcher.dispatch(
    Object.freeze({
      ...createSignal({ sequence: 7, handler: "stop", eventType: "system.stop" }),
      eventType: "command.config.reload",
    }),
    { presence: createPresence("offline") },
  ),
  ConversationHostSignalInvalidError,
);
await assert.rejects(
  dispatcher.dispatch(
    createSignal({ sequence: 8, handler: "stop", eventType: "system.stop" }),
    { presence: createPresence("online") },
  ),
  ConversationHostSignalInvalidError,
);

const serializedLogs = JSON.stringify(logger.entries);
for (const forbidden of [
  "FORBIDDEN_ROUTING_OUTPUT_FAILURE",
  "FORBIDDEN_RUNTIME_NOTIFICATION_FAILURE",
]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
for (const entry of logger.entries) {
  for (const forbiddenField of [
    "payload",
    "config",
    "prompt",
    "message",
    "stack",
    "cause",
  ]) {
    assert.equal(Object.hasOwn(entry.fields, forbiddenField), false);
  }
}

console.log("conversation host control dispatcher smoke passed");
