import assert from "node:assert/strict";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_OUTBOX_SOURCE_KIND,
  NovelProtocolValidationError,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelLifecycleRecord,
  captureNovelOutboxEntry,
  captureNovelOutboxPage,
  captureNovelOutboxPageRequest,
  captureNovelOutboxRecordIdentity,
  captureNovelOutboxSource,
  captureNovelTimestamp,
  compareNovelOutboxEntries,
} from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const novelId = captureNovelId("novel-outbox");
const canonicalSource = captureNovelOutboxSource({
  kind: NOVEL_OUTBOX_SOURCE_KIND.canonical,
});
const draftSource = captureNovelOutboxSource({
  kind: NOVEL_OUTBOX_SOURCE_KIND.draft,
  draftSessionId: captureNovelDraftSessionId("draft-outbox"),
});

const firstRecord = captureNovelLifecycleRecord({
  recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
  eventId: "outbox:event-1",
  eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted,
  novelId,
  conversationId: "conversation-outbox",
  occurredAt: captureNovelTimestamp("2026-08-02T10:00:00.000Z"),
  payload: {
    scope: "draft",
    outcome: "verified",
    affectedCount: 1,
  },
});
const secondRecord = captureNovelLifecycleRecord({
  ...firstRecord,
  eventId: "outbox:event-2",
  occurredAt: captureNovelTimestamp("2026-08-02T10:01:00.000Z"),
});

const firstEntry = captureNovelOutboxEntry({
  source: canonicalSource,
  record: firstRecord,
  recordDigest: digest,
  attemptCount: 0,
});
const secondEntry = captureNovelOutboxEntry({
  source: draftSource,
  record: secondRecord,
  recordDigest: digest,
  attemptCount: 2,
});

assert.equal(Object.isFrozen(firstEntry), true);
assert.equal(Object.isFrozen(firstEntry.source), true);
assert.equal(Object.isFrozen(firstEntry.record), true);
assert.equal(compareNovelOutboxEntries(firstEntry, secondEntry), -1);
assert.deepEqual(
  captureNovelOutboxPageRequest({
    after: {
      createdAt: firstRecord.occurredAt,
      eventId: firstRecord.eventId,
    },
    limit: 25,
  }),
  {
    after: {
      createdAt: firstRecord.occurredAt,
      eventId: firstRecord.eventId,
    },
    limit: 25,
  },
);

const page = captureNovelOutboxPage({
  entries: [firstEntry, secondEntry],
  nextCursor: {
    createdAt: secondRecord.occurredAt,
    eventId: secondRecord.eventId,
  },
});
assert.equal(Object.isFrozen(page.entries), true);
assert.equal(page.nextCursor.eventId, secondRecord.eventId);
assert.deepEqual(
  captureNovelOutboxRecordIdentity({
    source: draftSource,
    novelId,
    eventId: secondRecord.eventId,
    recordDigest: digest,
  }),
  {
    source: draftSource,
    novelId,
    eventId: secondRecord.eventId,
    recordDigest: digest,
  },
);

assert.throws(
  () => captureNovelOutboxEntry({ ...firstEntry, recordDigest: "sha256:bad" }),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureNovelOutboxEntry({ ...firstEntry, attemptCount: -1 }),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureNovelOutboxPageRequest({ limit: 0 }),
  NovelProtocolValidationError,
);
assert.throws(
  () =>
    captureNovelOutboxPage({
      entries: [secondEntry, firstEntry],
      nextCursor: {
        createdAt: firstRecord.occurredAt,
        eventId: firstRecord.eventId,
      },
    }),
  NovelProtocolValidationError,
);

console.log("novel outbox protocol smoke passed");
