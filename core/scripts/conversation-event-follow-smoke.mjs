import assert from "node:assert/strict";
import {
  ConversationEventSubscriptionAbortedError,
  ConversationEventSubscriptionConcurrentReadError,
  ConversationEventSubscriptionCursorAheadError,
  ConversationEventSubscriptionJournalPageError,
  ConversationEventSubscriptionJournalWatermarkError,
  ConversationEventSubscriptionServiceClosingError,
  ConversationEventSubscriptionServiceClosedError,
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
} from "../dist/index.js";

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

class MemoryConversationJournalReader {
  constructor(events = []) {
    this.events = [...events].sort((left, right) => left.sequence - right.sequence);
    this.onGetHighWatermark = undefined;
    this.transformPage = undefined;
  }

  append(event) {
    this.events.push(event);
    this.events.sort((left, right) => left.sequence - right.sequence);
  }

  async getHighWatermark(conversationId) {
    if (this.onGetHighWatermark !== undefined) {
      const hook = this.onGetHighWatermark;
      this.onGetHighWatermark = undefined;
      await hook();
    }
    return this.events
      .filter((event) => event.conversationId === conversationId)
      .reduce((highWatermark, event) => Math.max(highWatermark, event.sequence), 0);
  }

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

  async list(query) {
    const currentHighWatermark = this.events
      .filter((event) => event.conversationId === query.conversationId)
      .reduce((highWatermark, event) => Math.max(highWatermark, event.sequence), 0);
    const highWatermark = Math.min(
      currentHighWatermark,
      query.throughSequence ?? currentHighWatermark,
    );
    const afterSequence = "afterSequence" in query.anchor ? query.anchor.afterSequence : 0;
    const matches = this.events.filter(
      (event) =>
        event.conversationId === query.conversationId &&
        event.sequence > afterSequence &&
        event.sequence <= highWatermark &&
        (query.direction === undefined || event.direction === query.direction) &&
        (query.eventTypes === undefined || query.eventTypes.includes(event.eventType)) &&
        (query.runId === undefined || event.runId === query.runId) &&
        (query.turnId === undefined || event.turnId === query.turnId),
    );
    const events = matches.slice(0, query.limit ?? 100);
    const page = {
      events,
      highWatermark,
      hasPrevious: false,
      hasNext: matches.length > events.length,
    };
    return this.transformPage === undefined ? page : this.transformPage(page, query);
  }
}

function createEvent(sequence, overrides = {}) {
  return {
    id: `follow-event-${sequence}`,
    conversationId: "conversation-follow",
    eventType: "agent.turn",
    schemaVersion: 1,
    timestamp: "2026-08-01T00:00:00.000Z",
    direction: "output",
    sequence,
    recordedAt: "2026-08-01T00:00:00.001Z",
    payload: { text: "SMOKE_SECRET_FOLLOW_PAYLOAD" },
    ...overrides,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function closeServices(service, hub) {
  await service.close();
  await hub.close();
}

const logEntries = [];
const logger = new CollectingLogger(logEntries);

const raceJournal = new MemoryConversationJournalReader([createEvent(1)]);
const raceHub = new InMemoryConversationEventHub({ logger });
raceJournal.onGetHighWatermark = async () => {
  const event = createEvent(2);
  raceJournal.append(event);
  await raceHub.publish(event);
};
const raceService = new JournalConversationEventSubscriptionService({
  journal: raceJournal,
  hub: raceHub,
  logger,
  pageSize: 1,
});
const raceSubscription = raceService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
  liveBufferCapacity: 4,
});
assert.equal((await raceSubscription.next()).value.sequence, 1);
const afterHighWatermark = createEvent(3);
raceJournal.append(afterHighWatermark);
await raceHub.publish(afterHighWatermark);
assert.equal((await raceSubscription.next()).value.sequence, 2);
assert.equal((await raceSubscription.next()).value.sequence, 3);
await closeServices(raceService, raceHub);

const latestJournal = new MemoryConversationJournalReader([createEvent(1), createEvent(2)]);
const latestHub = new InMemoryConversationEventHub({ logger });
const latestService = new JournalConversationEventSubscriptionService({
  journal: latestJournal,
  hub: latestHub,
  logger,
});
const latestSubscription = latestService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "latest" },
});
const latestEvent = createEvent(3);
latestJournal.append(latestEvent);
await latestHub.publish(latestEvent);
assert.equal((await latestSubscription.next()).value.sequence, 3);
await closeServices(latestService, latestHub);

const filteredJournal = new MemoryConversationJournalReader([
  createEvent(1, { direction: "input", eventType: "user.message", runId: "run-a" }),
  createEvent(2, { direction: "input", eventType: "user.message", runId: "run-target" }),
  createEvent(3, { direction: "output", eventType: "agent.turn", runId: "run-target" }),
]);
const filteredHub = new InMemoryConversationEventHub({ logger });
const filteredService = new JournalConversationEventSubscriptionService({
  journal: filteredJournal,
  hub: filteredHub,
  logger,
  pageSize: 1,
});
const filteredSubscription = filteredService.subscribe({
  conversationId: "conversation-follow",
  start: { afterSequence: 0 },
  filter: {
    direction: "input",
    eventTypes: ["user.message"],
    runId: "run-target",
  },
});
assert.equal((await filteredSubscription.next()).value.sequence, 2);
await filteredSubscription.close();
await closeServices(filteredService, filteredHub);

const emptyJournal = new MemoryConversationJournalReader([createEvent(1)]);
const emptyHub = new InMemoryConversationEventHub({ logger });
const emptyService = new JournalConversationEventSubscriptionService({
  journal: emptyJournal,
  hub: emptyHub,
  logger,
});
const emptySubscription = emptyService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
  filter: { eventTypes: [] },
});
const emptyLiveEvent = createEvent(2);
emptyJournal.append(emptyLiveEvent);
await emptyHub.publish(emptyLiveEvent);
const emptyRead = emptySubscription.next();
await emptySubscription.close();
assert.deepEqual(await emptyRead, { done: true, value: undefined });
await closeServices(emptyService, emptyHub);

const cursorJournal = new MemoryConversationJournalReader([createEvent(1), createEvent(2)]);
const cursorHub = new InMemoryConversationEventHub({ logger });
const cursorService = new JournalConversationEventSubscriptionService({
  journal: cursorJournal,
  hub: cursorHub,
  logger,
});
const cursorSubscription = cursorService.subscribe({
  conversationId: "conversation-follow",
  start: { afterSequence: 3 },
});
await assert.rejects(
  () => cursorSubscription.next(),
  ConversationEventSubscriptionCursorAheadError,
);
await closeServices(cursorService, cursorHub);

const watermarkJournal = new MemoryConversationJournalReader([createEvent(1)]);
watermarkJournal.transformPage = (page) => ({ ...page, highWatermark: 0 });
const watermarkHub = new InMemoryConversationEventHub({ logger });
const watermarkService = new JournalConversationEventSubscriptionService({
  journal: watermarkJournal,
  hub: watermarkHub,
  logger,
});
const watermarkSubscription = watermarkService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
});
await assert.rejects(
  () => watermarkSubscription.next(),
  ConversationEventSubscriptionJournalWatermarkError,
);
await closeServices(watermarkService, watermarkHub);

const invalidPageJournal = new MemoryConversationJournalReader([createEvent(1)]);
invalidPageJournal.transformPage = (page) => ({
  ...page,
  events: [createEvent(1, { conversationId: "conversation-other" })],
});
const invalidPageHub = new InMemoryConversationEventHub({ logger });
const invalidPageService = new JournalConversationEventSubscriptionService({
  journal: invalidPageJournal,
  hub: invalidPageHub,
  logger,
});
const invalidPageSubscription = invalidPageService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
});
await assert.rejects(
  () => invalidPageSubscription.next(),
  ConversationEventSubscriptionJournalPageError,
);
await closeServices(invalidPageService, invalidPageHub);

const overflowJournal = new MemoryConversationJournalReader([createEvent(1), createEvent(2)]);
const overflowHub = new InMemoryConversationEventHub({ logger });
const overflowService = new JournalConversationEventSubscriptionService({
  journal: overflowJournal,
  hub: overflowHub,
  logger,
});
const overflowSubscription = overflowService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
  liveBufferCapacity: 1,
});
const overflowEvent3 = createEvent(3);
const overflowEvent4 = createEvent(4);
overflowJournal.append(overflowEvent3);
overflowJournal.append(overflowEvent4);
await overflowHub.publish(overflowEvent3);
await overflowHub.publish(overflowEvent4);
assert.equal((await overflowSubscription.next()).value.sequence, 1);
assert.equal((await overflowSubscription.next()).value.sequence, 2);
assert.equal((await overflowSubscription.next()).value.sequence, 3);
assert.equal((await overflowSubscription.next()).value.sequence, 4);
assert.ok(
  logger.entries.some(
    (entry) =>
      entry.level === "warn" &&
      entry.event === "conversation_event.follow.recovery_started",
  ),
);
await closeServices(overflowService, overflowHub);

const abortJournal = new MemoryConversationJournalReader([]);
const abortHub = new InMemoryConversationEventHub({ logger });
const abortService = new JournalConversationEventSubscriptionService({
  journal: abortJournal,
  hub: abortHub,
  logger,
});
const abortController = new AbortController();
const abortSubscription = abortService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
  signal: abortController.signal,
});
const abortRead = abortSubscription.next();
abortController.abort("SMOKE_SECRET_FOLLOW_ABORT_REASON");
await assert.rejects(() => abortRead, ConversationEventSubscriptionAbortedError);
await closeServices(abortService, abortHub);

const initializationAbortJournal = new MemoryConversationJournalReader([]);
const initializationGate = createDeferred();
initializationAbortJournal.onGetHighWatermark = async () => {
  await initializationGate.promise;
};
const initializationAbortHub = new InMemoryConversationEventHub({ logger });
const initializationAbortService = new JournalConversationEventSubscriptionService({
  journal: initializationAbortJournal,
  hub: initializationAbortHub,
  logger,
});
const initializationAbortController = new AbortController();
const initializationAbortSubscription = initializationAbortService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
  signal: initializationAbortController.signal,
});
const initializationAbortRead = initializationAbortSubscription.next();
initializationAbortController.abort("SMOKE_SECRET_INITIALIZATION_ABORT_REASON");
initializationGate.resolve();
await assert.rejects(
  () => initializationAbortRead,
  ConversationEventSubscriptionAbortedError,
);
await closeServices(initializationAbortService, initializationAbortHub);

const concurrentJournal = new MemoryConversationJournalReader([]);
const concurrentHub = new InMemoryConversationEventHub({ logger });
const concurrentService = new JournalConversationEventSubscriptionService({
  journal: concurrentJournal,
  hub: concurrentHub,
  logger,
});
const concurrentSubscription = concurrentService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
});
const firstConcurrentRead = concurrentSubscription.next();
await assert.rejects(
  () => concurrentSubscription.next(),
  ConversationEventSubscriptionConcurrentReadError,
);
const concurrentEvent = createEvent(1);
concurrentJournal.append(concurrentEvent);
await concurrentHub.publish(concurrentEvent);
assert.equal((await firstConcurrentRead).value.sequence, 1);
await closeServices(concurrentService, concurrentHub);

const closingJournal = new MemoryConversationJournalReader([]);
const closingHub = new InMemoryConversationEventHub({ logger });
const closingService = new JournalConversationEventSubscriptionService({
  journal: closingJournal,
  hub: closingHub,
  logger,
});
const closingSubscription = closingService.subscribe({
  conversationId: "conversation-follow",
  start: { from: "start" },
});
const closingRead = closingSubscription.next();
const serviceClose = closingService.close();
assert.throws(
  () =>
    closingService.subscribe({
      conversationId: "conversation-follow",
      start: { from: "latest" },
    }),
  ConversationEventSubscriptionServiceClosingError,
);
assert.deepEqual(await closingRead, { done: true, value: undefined });
await serviceClose;
assert.throws(
  () =>
    closingService.subscribe({
      conversationId: "conversation-follow",
      start: { from: "latest" },
    }),
  ConversationEventSubscriptionServiceClosedError,
);
await closingHub.close();

const serializedLogs = JSON.stringify(logEntries);
assert.equal(serializedLogs.includes("SMOKE_SECRET_FOLLOW_PAYLOAD"), false);
assert.equal(serializedLogs.includes("SMOKE_SECRET_FOLLOW_ABORT_REASON"), false);
assert.equal(serializedLogs.includes("SMOKE_SECRET_INITIALIZATION_ABORT_REASON"), false);
assert.equal(serializedLogs.includes('"payload"'), false);

console.log("Task 1D-D Conversation Event follow smoke passed");
