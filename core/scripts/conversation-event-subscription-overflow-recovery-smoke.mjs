import assert from "node:assert/strict";
import {
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
} from "../dist/index.js";

class CollectingLogger {
  constructor(entries, bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

class MemoryConversationJournalReader {
  constructor() {
    this.events = [];
  }
  append(event) {
    this.events.push(event);
    this.events.sort((left, right) => left.sequence - right.sequence);
  }
  async getHighWatermark(conversationId) {
    return this.events
      .filter((event) => event.conversationId === conversationId)
      .reduce((max, event) => Math.max(max, event.sequence), 0);
  }
  async list(query) {
    const currentHighWatermark = this.events
      .filter((event) => event.conversationId === query.conversationId)
      .reduce((max, event) => Math.max(max, event.sequence), 0);
    const highWatermark = Math.min(
      currentHighWatermark,
      query.throughSequence ?? currentHighWatermark,
    );
    const afterSequence = "afterSequence" in query.anchor
      ? query.anchor.afterSequence
      : 0;
    const matches = this.events.filter(
      (event) =>
        event.conversationId === query.conversationId &&
        event.sequence > afterSequence &&
        event.sequence <= highWatermark,
    );
    const events = matches.slice(0, query.limit ?? 100);
    return {
      events,
      highWatermark,
      hasPrevious: false,
      hasNext: matches.length > events.length,
      ...(matches.length > events.length
        ? { nextAfterSequence: events.at(-1)?.sequence }
        : {}),
    };
  }
}

function createEvent(sequence) {
  return {
    id: `overflow-recovery-event-${sequence}`,
    conversationId: "conversation-overflow-recovery",
    eventType: "agent.turn",
    schemaVersion: 1,
    timestamp: "2026-08-05T00:00:00.000Z",
    direction: "output",
    sequence,
    recordedAt: "2026-08-05T00:00:00.001Z",
    payload: { text: "SMOKE_SECRET_OVERFLOW_PAYLOAD" },
  };
}

const logEntries = [];
const logger = new CollectingLogger(logEntries);
const journal = new MemoryConversationJournalReader();
const hub = new InMemoryConversationEventHub({ logger });
const service = new JournalConversationEventSubscriptionService({
  journal,
  hub,
  logger,
});

const subscription = service.subscribe({
  conversationId: "conversation-overflow-recovery",
  start: { afterSequence: 0 },
  liveBufferCapacity: 2,
});

for (let sequence = 1; sequence <= 10; sequence += 1) {
  const event = createEvent(sequence);
  journal.append(event);
  await hub.publish(event);
}

// The live buffer overflows immediately; the first read recovers via the pager.
assert.equal((await subscription.next()).value.sequence, 1);
assert.equal((await subscription.next()).value.sequence, 2);

// Publish another burst while history delivery is still in progress; the
// recreated live subscription overflows again and recovery must catch up.
for (let sequence = 11; sequence <= 20; sequence += 1) {
  const event = createEvent(sequence);
  journal.append(event);
  await hub.publish(event);
}

const delivered = [1, 2];
for (let sequence = 3; sequence <= 20; sequence += 1) {
  const result = await subscription.next();
  delivered.push(result.value.sequence);
}

assert.deepEqual(
  delivered,
  Array.from({ length: 20 }, (_, index) => index + 1),
);
assert.equal(new Set(delivered).size, delivered.length);
assert.ok(
  logEntries.some(
    (entry) =>
      entry.level === "warn" &&
      entry.event === "conversation_event.follow.recovery_started",
  ),
);
assert.ok(
  logEntries.some(
    (entry) =>
      entry.level === "warn" &&
      entry.event === "conversation_event.follow.recovery_resubscribed",
  ),
);

await service.close();
await hub.close();
console.log("CORE_SMOKE_TEST_RESULT=pass conversation-event-subscription-overflow-recovery");
