import assert from "node:assert/strict";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NovelProtocolValidationError,
  canonicalizeNovelLifecycleRecord,
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelLifecycleRecord,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";

const record = captureNovelLifecycleRecord({
  recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
  eventId: "novel-event:commit-1",
  eventType: NOVEL_LIFECYCLE_EVENT_TYPE.commitCompleted,
  novelId: captureNovelId("novel-lifecycle"),
  conversationId: "conversation-lifecycle",
  occurredAt: captureNovelTimestamp("2026-08-02T08:00:00.000Z"),
  payload: {
    draftSessionId: captureNovelDraftSessionId("draft-lifecycle"),
    commitId: captureNovelCommitId("commit-lifecycle"),
    baseRevision: captureNovelRevision("revision-before"),
    resultRevision: captureNovelRevision("revision-after"),
    operationCount: 3,
  },
});
assert.equal(Object.isFrozen(record), true);
assert.equal(Object.isFrozen(record.payload), true);
assert.equal(
  canonicalizeNovelLifecycleRecord(record),
  canonicalizeNovelLifecycleRecord({ ...record, payload: { ...record.payload } }),
);
assert.throws(
  () => captureNovelLifecycleRecord({ ...record, payload: { ...record.payload, text: "forbidden" } }),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureNovelLifecycleRecord({ ...record, eventId: "invalid event id" }),
  NovelProtocolValidationError,
);
assert.equal(canonicalizeNovelLifecycleRecord(record).includes("forbidden"), false);
console.log("novel lifecycle record smoke passed");
