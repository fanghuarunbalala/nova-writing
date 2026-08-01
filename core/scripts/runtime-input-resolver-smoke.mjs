import assert from "node:assert/strict";
import {
  createCoreEventSchemaRegistry,
  JournalRuntimeInputResolver,
  RUNTIME_INPUT_RESOLUTION_FAILURE,
  RuntimeInputResolutionError,
} from "../dist/index.js";

class FakeJournal {
  constructor(event, failure) { this.event = event; this.failure = failure; this.requests = []; }
  async getBySequence(conversationId, sequence) {
    this.requests.push({ conversationId, sequence });
    if (this.failure) throw this.failure;
    return this.event;
  }
  async getHighWatermark() { return 0; }
  async getByEventId() { return undefined; }
  async list() { return { events: [], highWatermark: 0 }; }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) { this.entries.push({ level, event, fields: { ...this.bindings, ...fields } }); }
}

const secret = "FORBIDDEN_RESOLVER_NOVEL_TEXT";
const event = {
  id: "input-resolver-1",
  conversationId: "conversation-resolver",
  eventType: "user.message",
  schemaVersion: 1,
  priority: 500,
  timestamp: "2026-08-01T09:00:00.000Z",
  correlationId: "correlation-resolver",
  payload: { text: secret },
  direction: "input",
  sequence: 61,
  recordedAt: "2026-08-01T09:00:01.000Z",
};
const reference = {
  conversationId: event.conversationId,
  inputEventId: event.id,
  eventType: event.eventType,
  sequence: event.sequence,
  correlationId: event.correlationId,
};
const logs = [];
const journal = new FakeJournal(event);
const resolver = new JournalRuntimeInputResolver({
  journal,
  eventSchemaRegistry: createCoreEventSchemaRegistry(),
  logger: new CollectingLogger(logs),
});
const resolved = await resolver.resolve(reference);
event.payload.text = "mutated";
assert.equal(resolved.payload.text, secret);
assert.equal(Object.isFrozen(resolved), true);
assert.equal(Object.isFrozen(resolved.payload), true);
assert.deepEqual(journal.requests, [{ conversationId: event.conversationId, sequence: 61 }]);

const mutableReference = { ...reference };
const stableResolution = resolver.resolve(mutableReference);
mutableReference.inputEventId = "mutated-during-read";
mutableReference.correlationId = "mutated-during-read";
assert.equal((await stableResolution).id, event.id);

async function expectFailure(candidateEvent, candidateReference, failure, readFailure) {
  const candidate = new JournalRuntimeInputResolver({
    journal: new FakeJournal(candidateEvent, readFailure),
    eventSchemaRegistry: createCoreEventSchemaRegistry(),
    logger: new CollectingLogger(logs),
  });
  await assert.rejects(
    () => candidate.resolve(candidateReference),
    (error) => error instanceof RuntimeInputResolutionError && error.failure === failure,
  );
}

await expectFailure(undefined, reference, RUNTIME_INPUT_RESOLUTION_FAILURE.notFound);
await expectFailure(
  { ...resolved, direction: "output" },
  reference,
  RUNTIME_INPUT_RESOLUTION_FAILURE.directionMismatch,
);
await expectFailure(
  { ...resolved, id: "different-input" },
  reference,
  RUNTIME_INPUT_RESOLUTION_FAILURE.identityMismatch,
);
await expectFailure(
  { ...resolved, priority: 123 },
  reference,
  RUNTIME_INPUT_RESOLUTION_FAILURE.invalidEvent,
);
await expectFailure(
  undefined,
  reference,
  RUNTIME_INPUT_RESOLUTION_FAILURE.readFailed,
  new Error("FORBIDDEN_RESOLVER_RAW_ERROR"),
);
await assert.rejects(
  () => resolver.resolve({ ...reference, sequence: 0 }),
  (error) =>
    error instanceof RuntimeInputResolutionError &&
    error.failure === RUNTIME_INPUT_RESOLUTION_FAILURE.invalidReference,
);
await assert.rejects(
  () => resolver.resolve({ ...reference, correlationId: "" }),
  (error) =>
    error instanceof RuntimeInputResolutionError &&
    error.failure === RUNTIME_INPUT_RESOLUTION_FAILURE.invalidReference,
);

const serializedLogs = JSON.stringify(logs);
for (const forbidden of [secret, "FORBIDDEN_RESOLVER_RAW_ERROR", "payload", "stack", "cause", "path"]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(logs.some((entry) => entry.event === "runtime.input.resolved"), true);
assert.equal(logs.some((entry) => entry.event === "runtime.input.resolve_failed"), true);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.input.resolve_failed" &&
      entry.fields.failure === RUNTIME_INPUT_RESOLUTION_FAILURE.invalidReference,
  ),
  true,
);

console.log("runtime input resolver smoke passed");
