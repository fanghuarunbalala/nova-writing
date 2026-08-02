import assert from "node:assert/strict";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_OUTBOX_ATTEMPT_STATUS,
  NOVEL_OUTBOX_PUBLICATION_STATUS,
  ConversationNovelLifecycleOutputPublisher,
  NovelOutboxDispatchCoordinator,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelLifecycleRecord,
  captureNovelOutboxPage,
  captureNovelTimestamp,
  compareNovelOutboxEntries,
} from "../dist/index.js";

class MemoryOutboxStore {
  constructor(source, entries) {
    this.source = source;
    this.entries = entries;
    this.attempts = new Map();
    this.published = new Set();
  }
  async listPending({ limit }) {
    const entries = this.entries
      .filter((entry) => !this.published.has(entry.record.eventId))
      .sort(compareNovelOutboxEntries)
      .slice(0, limit)
      .map((entry) => ({
        ...entry,
        attemptCount: this.attempts.get(entry.record.eventId) ?? 0,
      }));
    return captureNovelOutboxPage({
      entries,
      ...(entries.length === 0
        ? {}
        : {
            nextCursor: {
              createdAt: entries.at(-1).record.occurredAt,
              eventId: entries.at(-1).record.eventId,
            },
          }),
    });
  }
  async recordAttempt(identity) {
    const entry = this.entries.find(
      (value) => value.record.eventId === identity.eventId,
    );
    if (!entry) return { status: NOVEL_OUTBOX_ATTEMPT_STATUS.missing };
    if (this.published.has(identity.eventId)) {
      return {
        status: NOVEL_OUTBOX_ATTEMPT_STATUS.alreadyPublished,
        attemptCount: this.attempts.get(identity.eventId) ?? 0,
      };
    }
    const attemptCount = (this.attempts.get(identity.eventId) ?? 0) + 1;
    this.attempts.set(identity.eventId, attemptCount);
    return { status: NOVEL_OUTBOX_ATTEMPT_STATUS.recorded, attemptCount };
  }
  async markPublished(request) {
    if (!this.entries.some((entry) => entry.record.eventId === request.eventId)) {
      return { status: NOVEL_OUTBOX_PUBLICATION_STATUS.missing };
    }
    this.published.add(request.eventId);
    return {
      status: NOVEL_OUTBOX_PUBLICATION_STATUS.published,
      publishedAt: request.publishedAt,
    };
  }
}

class RecordingOutputPublisher {
  constructor() { this.eventIds = []; }
  async publish(event) {
    const snapshot = event.getSnapshot();
    this.eventIds.push(snapshot.id);
    return {
      status: "recorded",
      conversationId: snapshot.conversationId,
      outputEventId: snapshot.id,
      sequence: this.eventIds.length,
      recordedAt: "2026-08-02T14:30:00.000Z",
    };
  }
}

const novelId = captureNovelId("novel-outbox-coordinator");
const canonicalSource = { kind: "canonical" };
const draftSource = {
  kind: "draft",
  draftSessionId: captureNovelDraftSessionId("draft-outbox-coordinator"),
};
const entry = (source, eventId, occurredAt) => ({
  source,
  record: captureNovelLifecycleRecord({
    recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
    eventId,
    eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted,
    novelId,
    conversationId: "conversation-outbox-coordinator",
    occurredAt: captureNovelTimestamp(occurredAt),
    payload: { scope: "draft", outcome: "verified", affectedCount: 1 },
  }),
  recordDigest: `sha256:${"a".repeat(64)}`,
  attemptCount: 0,
});

const canonicalStore = new MemoryOutboxStore(canonicalSource, [
  entry(canonicalSource, "coordinator:canonical", "2026-08-02T14:01:00.000Z"),
]);
const draftStore = new MemoryOutboxStore(draftSource, [
  entry(draftSource, "coordinator:draft-1", "2026-08-02T14:00:00.000Z"),
  entry(draftSource, "coordinator:draft-2", "2026-08-02T14:02:00.000Z"),
]);
const outputPublisher = new RecordingOutputPublisher();
const coordinator = new NovelOutboxDispatchCoordinator({
  stores: [canonicalStore, draftStore],
  publisher: new ConversationNovelLifecycleOutputPublisher(outputPublisher),
});
const result = await coordinator.dispatchPending();
assert.deepEqual(outputPublisher.eventIds, [
  "coordinator:draft-1",
  "coordinator:canonical",
  "coordinator:draft-2",
]);
assert.equal(result.attemptedCount, 3);
assert.equal(result.recordedCount, 3);
assert.deepEqual(
  result.sourceResults.map((value) => [value.source.kind, value.recordedCount]),
  [["canonical", 1], ["draft", 2]],
);
assert.equal((await coordinator.dispatchPending()).attemptedCount, 0);
assert.throws(
  () =>
    new NovelOutboxDispatchCoordinator({
      stores: [canonicalStore, canonicalStore],
      publisher: new ConversationNovelLifecycleOutputPublisher(outputPublisher),
    }),
  TypeError,
);

console.log("novel outbox coordinator smoke passed");
