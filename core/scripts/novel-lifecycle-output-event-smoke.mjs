import assert from "node:assert/strict";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NovelLifecycleOutputEvent,
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  coreEventSchemaRegistry,
} from "../dist/index.js";

const base = {
  recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
  novelId: captureNovelId("novel-output-lifecycle"),
  conversationId: "conversation-output-lifecycle",
  occurredAt: captureNovelTimestamp("2026-08-02T09:00:00.000Z"),
};
const records = [
  { ...base, eventId: "novel-event:draft-started", eventType: NOVEL_LIFECYCLE_EVENT_TYPE.draftStarted, payload: { draftSessionId: captureNovelDraftSessionId("draft-output"), baseRevision: captureNovelRevision("revision-output-base") } },
  { ...base, eventId: "novel-event:commit-completed", eventType: NOVEL_LIFECYCLE_EVENT_TYPE.commitCompleted, payload: { draftSessionId: captureNovelDraftSessionId("draft-output"), commitId: captureNovelCommitId("commit-output"), baseRevision: captureNovelRevision("revision-output-base"), resultRevision: captureNovelRevision("revision-output-result"), operationCount: 2 } },
  { ...base, eventId: "novel-event:recovery", eventType: NOVEL_LIFECYCLE_EVENT_TYPE.recoveryCompleted, payload: { scope: "draft", outcome: "recovered", affectedCount: 1 } },
  { ...base, eventId: "novel-event:canonical-write-applied", eventType: NOVEL_LIFECYCLE_EVENT_TYPE.canonicalWriteApplied, payload: { operationId: "op-canonical-write-applied", operationType: "story-unit.create", operationVersion: 1, baseRevision: captureNovelRevision("revision-output-base"), resultRevision: captureNovelRevision("revision-output-result") } },
];
for (const record of records) {
  const event = new NovelLifecycleOutputEvent(record);
  const snapshot = event.getSnapshot();
  assert.equal(snapshot.id, record.eventId);
  assert.equal(snapshot.conversationId, record.conversationId);
  assert.equal(snapshot.timestamp, record.occurredAt);
  assert.equal(snapshot.eventType, `novel.${record.eventType}`);
  assert.equal(snapshot.payload.novelId, record.novelId);
  assert.equal(snapshot.payload.lifecycleVersion, 1);
  assert.deepEqual(coreEventSchemaRegistry.validateOutput(snapshot), snapshot);
  assert.throws(() => coreEventSchemaRegistry.validateOutput({ ...snapshot, payload: { ...snapshot.payload, text: "forbidden" } }));
}
console.log("novel lifecycle output event smoke passed");
