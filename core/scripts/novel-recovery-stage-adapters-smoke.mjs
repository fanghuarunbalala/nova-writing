import assert from "node:assert/strict";
import {
  NOVEL_RECOVERY_PHASE,
  NovelDraftRecoveryStage,
  NovelOutboxRecoveryStage,
  captureNovelDraftSessionId,
  captureNovelId,
} from "../dist/index.js";

const novelId = captureNovelId("novel_recovery_stage_adapters");
const draft = (id) => captureNovelDraftSessionId(id);
const draftStage = new NovelDraftRecoveryStage({
  async recoverDraftSessions() {
    return {
      recoveredDraftSessionIds: [draft("draft_retained"), draft("draft_reset")],
      resetDraftSessionIds: [draft("draft_reset")],
      rolledBackDraftSessionIds: [draft("draft_rolled_back")],
      removedTerminalSnapshotIds: [draft("draft_terminal")],
      removedCandidateSnapshotIds: [draft("draft_candidate")],
      removedOrphanSnapshotIds: [draft("draft_orphan")],
    };
  },
});
assert.deepEqual(await draftStage.recover(novelId), {
  phase: NOVEL_RECOVERY_PHASE.draft,
  inspectedCount: 6,
  repairedCount: 2,
  removedCount: 3,
  retainedCount: 1,
  publishedCount: 0,
});

const outboxStage = new NovelOutboxRecoveryStage({
  async dispatchPending() {
    return {
      attemptedCount: 3,
      recordedCount: 2,
      duplicateCount: 1,
      alreadyPublishedCount: 1,
      sourceResults: [],
    };
  },
});
assert.deepEqual(await outboxStage.recover(novelId), {
  phase: NOVEL_RECOVERY_PHASE.outbox,
  inspectedCount: 4,
  repairedCount: 1,
  removedCount: 0,
  retainedCount: 1,
  publishedCount: 3,
});

console.log("novel recovery stage adapters smoke passed");
