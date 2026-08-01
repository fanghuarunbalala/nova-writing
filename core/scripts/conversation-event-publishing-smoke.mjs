import assert from "node:assert/strict";
import {
  ConversationJournalServiceClosedError,
  ConversationJournalServiceClosingError,
  ConversationJournalServiceReceiptError,
  PublishingConversationJournalService,
} from "../dist/index.js";

const RECORDED_AT = "2026-08-01T00:00:00.001Z";

class CollectingLogger {
  constructor(entries, bindings = {}) {
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

class ControlledJournalWriter {
  constructor(handler) {
    this.handler = handler;
    this.requests = [];
    this.closeCalls = 0;
  }

  async append(request) {
    const index = this.requests.length;
    this.requests.push(request);
    return this.handler(request, index);
  }

  async close() {
    this.closeCalls += 1;
  }
}

class ControlledEventHub {
  constructor(handler = async () => undefined) {
    this.handler = handler;
    this.events = [];
    this.closeCalls = 0;
  }

  async publish(event) {
    this.events.push(event);
    await this.handler(event, this.events.length - 1);
  }

  subscribe() {
    throw new Error("Smoke Hub does not support subscriptions");
  }

  async close() {
    this.closeCalls += 1;
  }
}

function createInputRequest({
  conversationId = "conversation-a",
  eventId = "input-1",
  text = "hello",
} = {}) {
  return {
    direction: "input",
    snapshot: {
      id: eventId,
      conversationId,
      eventType: "user.message",
      schemaVersion: 1,
      priority: 100,
      timestamp: "2026-08-01T00:00:00.000Z",
      payload: {
        text,
        metadata: {
          tags: ["draft"],
        },
      },
    },
  };
}

function createOutputRequest({
  conversationId = "conversation-a",
  eventId = "output-1",
  text = "world",
} = {}) {
  return {
    direction: "output",
    snapshot: {
      id: eventId,
      conversationId,
      eventType: "agent.message",
      schemaVersion: 1,
      timestamp: "2026-08-01T00:00:00.000Z",
      payload: { text },
    },
  };
}

function createReceipt(
  request,
  { status = "appended", sequence = 1, recordedAt = RECORDED_AT } = {},
) {
  return {
    status,
    conversationId: request.snapshot.conversationId,
    eventId: request.snapshot.id,
    direction: request.direction,
    sequence,
    recordedAt,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function testPersistBeforePublish() {
  const order = [];
  const journal = new ControlledJournalWriter(async (request) => {
    order.push("journal");
    return createReceipt(request);
  });
  const hub = new ControlledEventHub(async () => {
    order.push("hub");
  });
  const service = new PublishingConversationJournalService({ journal, hub });

  const result = await service.append(createInputRequest());

  assert.deepEqual(order, ["journal", "hub"]);
  assert.equal(result.livePublication.status, "published");
}

async function testInputAndOutputSnapshots() {
  const journal = new ControlledJournalWriter(async (request, index) =>
    createReceipt(request, { sequence: index + 1 }),
  );
  const hub = new ControlledEventHub();
  const service = new PublishingConversationJournalService({ journal, hub });
  const input = createInputRequest();
  const output = createOutputRequest();

  const inputResult = await service.append(input);
  const outputResult = await service.append(output);

  assert.deepEqual(inputResult.event, {
    ...input.snapshot,
    direction: "input",
    sequence: 1,
    recordedAt: RECORDED_AT,
  });
  assert.deepEqual(outputResult.event, {
    ...output.snapshot,
    direction: "output",
    sequence: 2,
    recordedAt: RECORDED_AT,
  });
  assert.equal(Object.isFrozen(inputResult.event), true);
  assert.equal(Object.isFrozen(inputResult.event.payload), true);
  assert.deepEqual(hub.events, [inputResult.event, outputResult.event]);
}

async function testDuplicateSkipsPublish() {
  const journal = new ControlledJournalWriter(async (request) =>
    createReceipt(request, { status: "duplicate", sequence: 4 }),
  );
  const hub = new ControlledEventHub();
  const service = new PublishingConversationJournalService({ journal, hub });

  const result = await service.append(createInputRequest());

  assert.deepEqual(result.livePublication, {
    status: "skipped",
    reason: "duplicate",
  });
  assert.equal(hub.events.length, 0);
}

async function testJournalFailureDoesNotPublish() {
  const failure = new Error("journal-secret-message");
  const journal = new ControlledJournalWriter(async () => {
    throw failure;
  });
  const hub = new ControlledEventHub();
  const service = new PublishingConversationJournalService({ journal, hub });

  await assert.rejects(service.append(createInputRequest()), (error) => error === failure);
  assert.equal(hub.events.length, 0);
}

async function testHubFailureReturnsSafeIdentity() {
  class LivePublishFailure extends Error {
    code = "LIVE_PUBLISH_FAILED";

    constructor() {
      super("live-secret-message", { cause: new Error("live-secret-cause") });
      this.name = "LivePublishFailure";
    }
  }

  const journal = new ControlledJournalWriter(async (request) => createReceipt(request));
  const hub = new ControlledEventHub(async () => {
    throw new LivePublishFailure();
  });
  const service = new PublishingConversationJournalService({ journal, hub });

  const result = await service.append(createInputRequest());

  assert.deepEqual(result.livePublication, {
    status: "failed",
    errorName: "LivePublishFailure",
    errorCode: "LIVE_PUBLISH_FAILED",
  });
  assert.equal(JSON.stringify(result.livePublication).includes("secret"), false);
}

async function testReceiptValidation() {
  const cases = [
    (receipt) => ({ ...receipt, status: "unknown" }),
    (receipt) => ({ ...receipt, conversationId: "other-conversation" }),
    (receipt) => ({ ...receipt, eventId: "other-event" }),
    (receipt) => ({ ...receipt, direction: "output" }),
    (receipt) => ({ ...receipt, sequence: 0 }),
    (receipt) => ({ ...receipt, recordedAt: "not-a-timestamp" }),
  ];

  for (const mutate of cases) {
    const journal = new ControlledJournalWriter(async (request) =>
      mutate(createReceipt(request)),
    );
    const hub = new ControlledEventHub();
    const service = new PublishingConversationJournalService({ journal, hub });

    await assert.rejects(
      service.append(createInputRequest()),
      ConversationJournalServiceReceiptError,
    );
    assert.equal(hub.events.length, 0);
  }
}

async function testSameConversationSerializesThroughPublish() {
  const order = [];
  const firstPublishStarted = createDeferred();
  const releaseFirstPublish = createDeferred();
  const journal = new ControlledJournalWriter(async (request, index) => {
    order.push(`journal:${request.snapshot.id}`);
    return createReceipt(request, { sequence: index + 1 });
  });
  const hub = new ControlledEventHub(async (event, index) => {
    order.push(`hub:${event.id}`);
    if (index === 0) {
      firstPublishStarted.resolve();
      await releaseFirstPublish.promise;
    }
  });
  const service = new PublishingConversationJournalService({ journal, hub });

  const first = service.append(createInputRequest({ eventId: "input-1" }));
  await firstPublishStarted.promise;
  const second = service.append(createInputRequest({ eventId: "input-2" }));
  await flushTasks();
  assert.equal(journal.requests.length, 1);

  releaseFirstPublish.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(order, [
    "journal:input-1",
    "hub:input-1",
    "journal:input-2",
    "hub:input-2",
  ]);
}

async function testDifferentConversationsRunConcurrently() {
  const firstStarted = createDeferred();
  const releaseFirst = createDeferred();
  const journal = new ControlledJournalWriter(async (request) => {
    if (request.snapshot.conversationId === "conversation-a") {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
    return createReceipt(request);
  });
  const hub = new ControlledEventHub();
  const service = new PublishingConversationJournalService({ journal, hub });

  const first = service.append(createInputRequest({ conversationId: "conversation-a" }));
  await firstStarted.promise;
  const second = service.append(
    createInputRequest({ conversationId: "conversation-b", eventId: "input-b" }),
  );

  const secondResult = await second;
  assert.equal(secondResult.event.conversationId, "conversation-b");
  assert.equal(hub.events.some((event) => event.conversationId === "conversation-a"), false);

  releaseFirst.resolve();
  await first;
}

async function testPreviousFailureDoesNotBlockNextOperation() {
  const firstFailure = new Error("first-operation-failed");
  const journal = new ControlledJournalWriter(async (request, index) => {
    if (index === 0) throw firstFailure;
    return createReceipt(request);
  });
  const hub = new ControlledEventHub();
  const service = new PublishingConversationJournalService({ journal, hub });

  const first = service.append(createInputRequest({ eventId: "input-1" }));
  const second = service.append(createInputRequest({ eventId: "input-2" }));

  await assert.rejects(first, (error) => error === firstFailure);
  const result = await second;
  assert.equal(result.livePublication.status, "published");
  assert.equal(result.event.id, "input-2");
}

async function testRequestSnapshotCapturedBeforeQueueing() {
  const firstPublishStarted = createDeferred();
  const releaseFirstPublish = createDeferred();
  const journal = new ControlledJournalWriter(async (request, index) =>
    createReceipt(request, { sequence: index + 1 }),
  );
  const hub = new ControlledEventHub(async (_event, index) => {
    if (index === 0) {
      firstPublishStarted.resolve();
      await releaseFirstPublish.promise;
    }
  });
  const service = new PublishingConversationJournalService({ journal, hub });
  const first = service.append(createInputRequest({ eventId: "blocker" }));
  await firstPublishStarted.promise;

  const mutable = createInputRequest({ eventId: "captured", text: "original" });
  const second = service.append(mutable);
  mutable.snapshot.id = "mutated";
  mutable.snapshot.payload.text = "mutated";
  mutable.snapshot.payload.metadata.tags.push("mutated");

  releaseFirstPublish.resolve();
  await Promise.all([first, second]);

  const captured = journal.requests[1];
  assert.equal(captured.snapshot.id, "captured");
  assert.equal(captured.snapshot.payload.text, "original");
  assert.deepEqual(captured.snapshot.payload.metadata.tags, ["draft"]);
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.snapshot), true);
  assert.equal(Object.isFrozen(captured.snapshot.payload.metadata.tags), true);
}

async function testCloseWaitsAndRejectsNewAppends() {
  const appendStarted = createDeferred();
  const releaseAppend = createDeferred();
  const journal = new ControlledJournalWriter(async (request) => {
    appendStarted.resolve();
    await releaseAppend.promise;
    return createReceipt(request);
  });
  const hub = new ControlledEventHub();
  const service = new PublishingConversationJournalService({ journal, hub });
  const append = service.append(createInputRequest());
  await appendStarted.promise;

  const close = service.close();
  assert.equal(service.close(), close);
  assert.throws(
    () => service.append(createInputRequest({ eventId: "late-input" })),
    ConversationJournalServiceClosingError,
  );
  let closeSettled = false;
  void close.then(() => {
    closeSettled = true;
  });
  await flushTasks();
  assert.equal(closeSettled, false);

  releaseAppend.resolve();
  await append;
  await close;
  assert.equal(closeSettled, true);
  assert.throws(
    () => service.append(createInputRequest({ eventId: "closed-input" })),
    ConversationJournalServiceClosedError,
  );
  assert.equal(journal.closeCalls, 0);
  assert.equal(hub.closeCalls, 0);
}

async function testLogsRedactPayloadAndErrorDetails() {
  class RedactedLiveFailure extends Error {
    code = "REDACTED_LIVE_FAILURE";

    constructor() {
      super("forbidden-live-message", { cause: new Error("forbidden-live-cause") });
      this.name = "RedactedLiveFailure";
    }
  }

  const entries = [];
  const logger = new CollectingLogger(entries);
  const journal = new ControlledJournalWriter(async (request, index) => {
    if (index === 0) {
      const failure = new Error("forbidden-journal-message", {
        cause: new Error("forbidden-journal-cause"),
      });
      failure.name = "RedactedJournalFailure";
      throw failure;
    }
    return createReceipt(request);
  });
  const hub = new ControlledEventHub(async () => {
    throw new RedactedLiveFailure();
  });
  const service = new PublishingConversationJournalService({ journal, hub, logger });

  await assert.rejects(
    service.append(createInputRequest({ eventId: "failed", text: "forbidden-payload" })),
  );
  await service.append(
    createInputRequest({ eventId: "live-failed", text: "forbidden-payload" }),
  );
  await service.close();

  const serialized = JSON.stringify(entries);
  for (const forbidden of [
    "forbidden-payload",
    "forbidden-journal-message",
    "forbidden-journal-cause",
    "forbidden-live-message",
    "forbidden-live-cause",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  for (const entry of entries) {
    assert.equal(Object.hasOwn(entry.fields, "payload"), false);
    assert.equal(Object.hasOwn(entry.fields, "message"), false);
    assert.equal(Object.hasOwn(entry.fields, "stack"), false);
    assert.equal(Object.hasOwn(entry.fields, "cause"), false);
  }
}

await testPersistBeforePublish();
await testInputAndOutputSnapshots();
await testDuplicateSkipsPublish();
await testJournalFailureDoesNotPublish();
await testHubFailureReturnsSafeIdentity();
await testReceiptValidation();
await testSameConversationSerializesThroughPublish();
await testDifferentConversationsRunConcurrently();
await testPreviousFailureDoesNotBlockNextOperation();
await testRequestSnapshotCapturedBeforeQueueing();
await testCloseWaitsAndRejectsNewAppends();
await testLogsRedactPayloadAndErrorDetails();

console.log("conversation event publishing smoke passed");
