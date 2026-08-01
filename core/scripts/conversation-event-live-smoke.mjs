import assert from "node:assert/strict";
import {
  ConversationEventHubClosedError,
  ConversationEventHubPublishError,
  ConversationEventHubSequenceError,
  ConversationEventSubscriptionAbortedError,
  ConversationEventSubscriptionConcurrentReadError,
  ConversationEventSubscriptionOverflowError,
  InMemoryConversationEventHub,
} from "../dist/index.js";
import { InMemoryConversationEventSubscription } from "../dist/storage/journal/live/InMemoryConversationEventSubscription.js";

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

function createEvent(sequence, overrides = {}) {
  return {
    id: `event-${sequence}`,
    conversationId: "conversation-1",
    eventType: "agent.turn",
    schemaVersion: 1,
    timestamp: "2026-08-01T00:00:00.000Z",
    direction: "output",
    sequence,
    recordedAt: "2026-08-01T00:00:00.001Z",
    payload: { text: "SMOKE_SECRET_EVENT_PAYLOAD" },
    ...overrides,
  };
}

function createSubscription(options = {}) {
  return new InMemoryConversationEventSubscription({
    subscriptionId: options.subscriptionId ?? "subscription-1",
    conversationId: options.conversationId ?? "conversation-1",
    filter: options.filter ?? {},
    capacity: options.capacity ?? 2,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.onTerminated !== undefined
      ? { onTerminated: options.onTerminated }
      : {}),
  });
}

const logEntries = [];
const logger = new CollectingLogger(logEntries);

const fifo = createSubscription({ logger });
assert.equal(fifo.enqueue(createEvent(1)), "enqueued");
assert.equal(fifo.enqueue(createEvent(2)), "enqueued");
assert.equal(fifo.bufferedEventCount, 2);
assert.equal((await fifo.next()).value.sequence, 1);
assert.equal((await fifo.next()).value.sequence, 2);
assert.equal(fifo.lastDeliveredSequence, 2);
await fifo.close();

const direct = createSubscription({ subscriptionId: "subscription-direct", logger });
const directRead = direct.next();
assert.equal(direct.enqueue(createEvent(3)), "enqueued");
assert.equal((await directRead).value.sequence, 3);
assert.equal(direct.bufferedEventCount, 0);
await direct.close();

let overflowTerminated = 0;
const overflow = createSubscription({
  subscriptionId: "subscription-overflow",
  capacity: 1,
  logger,
  onTerminated: () => {
    overflowTerminated += 1;
  },
});
assert.equal(overflow.enqueue(createEvent(4)), "enqueued");
assert.equal((await overflow.next()).value.sequence, 4);
assert.equal(overflow.enqueue(createEvent(5)), "enqueued");
assert.equal(overflow.enqueue(createEvent(6)), "overflowed");
assert.equal(overflow.bufferedEventCount, 0);
await assert.rejects(
  () => overflow.next(),
  (error) =>
    error instanceof ConversationEventSubscriptionOverflowError &&
    error.lastDeliveredSequence === 4 &&
    error.capacity === 1,
);
await overflow.close();
assert.equal(overflowTerminated, 1);

const filtered = createSubscription({
  subscriptionId: "subscription-filtered",
  filter: { direction: "input", eventTypes: ["user.message"] },
  logger,
});
assert.equal(filtered.enqueue(createEvent(7)), "ignored");
assert.equal(
  filtered.enqueue(
    createEvent(8, {
      conversationId: "conversation-other",
      direction: "input",
      eventType: "user.message",
    }),
  ),
  "ignored",
);
assert.equal(
  filtered.enqueue(createEvent(9, { direction: "input", eventType: "user.message" })),
  "enqueued",
);
assert.equal((await filtered.next()).value.sequence, 9);
await filtered.close();

let closeTerminated = 0;
const closing = createSubscription({
  subscriptionId: "subscription-closing",
  logger,
  onTerminated: () => {
    closeTerminated += 1;
  },
});
const closingRead = closing.next();
await closing.close();
assert.deepEqual(await closingRead, { done: true, value: undefined });
await closing.close();
assert.deepEqual(await closing.next(), { done: true, value: undefined });
assert.equal(closeTerminated, 1);

const returning = createSubscription({ subscriptionId: "subscription-return", logger });
assert.deepEqual(await returning.return(), { done: true, value: undefined });
assert.equal(returning.state, "closed");

const concurrent = createSubscription({ subscriptionId: "subscription-concurrent", logger });
const firstConcurrentRead = concurrent.next();
await assert.rejects(
  () => concurrent.next(),
  ConversationEventSubscriptionConcurrentReadError,
);
concurrent.enqueue(createEvent(10));
assert.equal((await firstConcurrentRead).value.sequence, 10);
await concurrent.close();

const abortController = new AbortController();
let abortTerminated = 0;
const aborting = createSubscription({
  subscriptionId: "subscription-aborting",
  signal: abortController.signal,
  logger,
  onTerminated: () => {
    abortTerminated += 1;
  },
});
const abortRead = aborting.next();
abortController.abort("SMOKE_SECRET_ABORT_REASON");
await assert.rejects(() => abortRead, ConversationEventSubscriptionAbortedError);
await assert.rejects(() => aborting.next(), ConversationEventSubscriptionAbortedError);
await aborting.close();
assert.equal(abortTerminated, 1);

const preAbortedController = new AbortController();
preAbortedController.abort("SMOKE_SECRET_PRE_ABORT_REASON");
assert.throws(
  () =>
    createSubscription({
      subscriptionId: "subscription-pre-aborted",
      signal: preAbortedController.signal,
      logger,
    }),
  ConversationEventSubscriptionAbortedError,
);

const independentA = createSubscription({ subscriptionId: "subscription-a", capacity: 1, logger });
const independentB = createSubscription({ subscriptionId: "subscription-b", capacity: 1, logger });
independentA.enqueue(createEvent(11));
independentA.enqueue(createEvent(12));
assert.equal(independentA.state, "failed");
assert.equal(independentB.enqueue(createEvent(11)), "enqueued");
assert.equal((await independentB.next()).value.sequence, 11);
await independentB.close();

const serializedLogs = JSON.stringify(logEntries);
assert.equal(serializedLogs.includes("SMOKE_SECRET_EVENT_PAYLOAD"), false);
assert.equal(serializedLogs.includes("SMOKE_SECRET_ABORT_REASON"), false);
assert.equal(serializedLogs.includes("SMOKE_SECRET_PRE_ABORT_REASON"), false);
assert.equal(serializedLogs.includes('"payload"'), false);

const broadcastHub = new InMemoryConversationEventHub({ logger });
const broadcastAll = broadcastHub.subscribe({ conversationId: "conversation-1" });
const broadcastInput = broadcastHub.subscribe({
  conversationId: "conversation-1",
  filter: { direction: "input", eventTypes: ["user.message"] },
});
const isolated = broadcastHub.subscribe({ conversationId: "conversation-2" });
assert.notEqual(broadcastAll.id, broadcastInput.id);
const broadcastAllFirst = broadcastAll.next();
await broadcastHub.publish(createEvent(100));
assert.equal((await broadcastAllFirst).value.sequence, 100);
await broadcastHub.publish(
  createEvent(101, { direction: "input", eventType: "user.message" }),
);
assert.equal((await broadcastAll.next()).value.sequence, 101);
assert.equal((await broadcastInput.next()).value.sequence, 101);
await broadcastHub.publish(createEvent(50, { conversationId: "conversation-2" }));
assert.equal((await isolated.next()).value.sequence, 50);
await broadcastHub.close();

const filterHub = new InMemoryConversationEventHub({ logger });
const runTurnFiltered = filterHub.subscribe({
  conversationId: "conversation-filter",
  filter: { runId: "run-target", turnId: "turn-target" },
});
await filterHub.publish(
  createEvent(1, {
    conversationId: "conversation-filter",
    runId: "run-other",
    turnId: "turn-target",
  }),
);
await filterHub.publish(
  createEvent(2, {
    conversationId: "conversation-filter",
    runId: "run-target",
    turnId: "turn-target",
  }),
);
assert.equal((await runTurnFiltered.next()).value.sequence, 2);
await filterHub.close();

const overflowHub = new InMemoryConversationEventHub({ logger });
const slowHubSubscription = overflowHub.subscribe({
  conversationId: "conversation-overflow",
  capacity: 1,
});
const fastHubSubscription = overflowHub.subscribe({
  conversationId: "conversation-overflow",
  capacity: 1,
});
await overflowHub.publish(createEvent(1, { conversationId: "conversation-overflow" }));
assert.equal((await fastHubSubscription.next()).value.sequence, 1);
await overflowHub.publish(createEvent(2, { conversationId: "conversation-overflow" }));
await assert.rejects(
  () => slowHubSubscription.next(),
  ConversationEventSubscriptionOverflowError,
);
assert.equal((await fastHubSubscription.next()).value.sequence, 2);
await overflowHub.publish(createEvent(3, { conversationId: "conversation-overflow" }));
assert.equal((await fastHubSubscription.next()).value.sequence, 3);
await overflowHub.close();

const sequenceHub = new InMemoryConversationEventHub({ logger });
const sequenceA = sequenceHub.subscribe({ conversationId: "conversation-sequence-a" });
const sequenceB = sequenceHub.subscribe({ conversationId: "conversation-sequence-b" });
await sequenceHub.publish(createEvent(10, { conversationId: "conversation-sequence-a" }));
assert.equal((await sequenceA.next()).value.sequence, 10);
await sequenceHub.publish(createEvent(5, { conversationId: "conversation-sequence-b" }));
assert.equal((await sequenceB.next()).value.sequence, 5);
await assert.rejects(
  () => sequenceHub.publish(createEvent(12, { conversationId: "conversation-sequence-a" })),
  (error) =>
    error instanceof ConversationEventHubSequenceError &&
    error.expectedSequence === 11 &&
    error.actualSequence === 12,
);
await assert.rejects(() => sequenceA.next(), ConversationEventHubSequenceError);
await sequenceHub.publish(createEvent(6, { conversationId: "conversation-sequence-b" }));
assert.equal((await sequenceB.next()).value.sequence, 6);

const sequenceAfterGap = sequenceHub.subscribe({
  conversationId: "conversation-sequence-a",
});
await sequenceHub.publish(createEvent(13, { conversationId: "conversation-sequence-a" }));
assert.equal((await sequenceAfterGap.next()).value.sequence, 13);
await assert.rejects(
  () => sequenceHub.publish(createEvent(13, { conversationId: "conversation-sequence-a" })),
  ConversationEventHubSequenceError,
);
await assert.rejects(() => sequenceAfterGap.next(), ConversationEventHubSequenceError);

const sequenceAfterDuplicate = sequenceHub.subscribe({
  conversationId: "conversation-sequence-a",
});
await sequenceHub.publish(createEvent(14, { conversationId: "conversation-sequence-a" }));
assert.equal((await sequenceAfterDuplicate.next()).value.sequence, 14);
await assert.rejects(
  () => sequenceHub.publish(createEvent(12, { conversationId: "conversation-sequence-a" })),
  ConversationEventHubSequenceError,
);
await assert.rejects(
  () => sequenceAfterDuplicate.next(),
  ConversationEventHubSequenceError,
);

const sequenceAfterRegression = sequenceHub.subscribe({
  conversationId: "conversation-sequence-a",
});
await sequenceHub.publish(createEvent(15, { conversationId: "conversation-sequence-a" }));
assert.equal((await sequenceAfterRegression.next()).value.sequence, 15);
await sequenceHub.close();

const invalidHub = new InMemoryConversationEventHub({ logger });
await assert.rejects(
  () => invalidHub.publish(createEvent(0)),
  ConversationEventHubPublishError,
);
await invalidHub.close();

const lifecycleHub = new InMemoryConversationEventHub({ logger });
const preAbortedHubController = new AbortController();
preAbortedHubController.abort("SMOKE_SECRET_HUB_PRE_ABORT_REASON");
assert.throws(
  () =>
    lifecycleHub.subscribe({
      conversationId: "conversation-pre-aborted",
      signal: preAbortedHubController.signal,
    }),
  ConversationEventSubscriptionAbortedError,
);
const afterPreAbort = lifecycleHub.subscribe({
  conversationId: "conversation-pre-aborted",
});
await lifecycleHub.publish(createEvent(1, { conversationId: "conversation-pre-aborted" }));
assert.equal((await afterPreAbort.next()).value.sequence, 1);
const lifecycleSubscription = lifecycleHub.subscribe({ conversationId: "conversation-close" });
const lifecycleRead = lifecycleSubscription.next();
const lifecycleClose = lifecycleHub.close();
assert.throws(
  () => lifecycleHub.subscribe({ conversationId: "conversation-close" }),
  ConversationEventHubClosedError,
);
await assert.rejects(
  () => lifecycleHub.publish(createEvent(1, { conversationId: "conversation-close" })),
  ConversationEventHubClosedError,
);
assert.deepEqual(await lifecycleRead, { done: true, value: undefined });
await lifecycleClose;
await lifecycleHub.close();

const hubSerializedLogs = JSON.stringify(logEntries);
assert.equal(hubSerializedLogs.includes("SMOKE_SECRET_EVENT_PAYLOAD"), false);
assert.equal(hubSerializedLogs.includes("SMOKE_SECRET_HUB_PRE_ABORT_REASON"), false);
assert.equal(hubSerializedLogs.includes('"payload"'), false);

console.log("Task 1D-C Conversation Event Hub smoke passed");
