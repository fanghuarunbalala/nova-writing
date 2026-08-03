import assert from "node:assert/strict";
import {
  NOVEL_RECOVERY_PHASE,
  captureNovelId,
} from "../dist/index.js";
import { createNodeNovelRecoveryApplication } from "../dist/node/index.js";

const novelId = captureNovelId("novel_recovery_application");
const calls = [];
const application = createNodeNovelRecoveryApplication({
  novelId,
  commitRecovery: {
    async recover(receivedNovelId) {
      calls.push(NOVEL_RECOVERY_PHASE.commit);
      assert.equal(receivedNovelId, novelId);
      return {
        inspectedCount: 1,
        recoveredCount: 0,
        removedTemporaryCount: 0,
        removedOrphanCount: 0,
      };
    },
  },
  rebaseRecovery: stage(NOVEL_RECOVERY_PHASE.rebase),
  draftRecovery: {
    async recoverDraftSessions() {
      calls.push(NOVEL_RECOVERY_PHASE.draft);
      return {
        recoveredDraftSessionIds: [],
        resetDraftSessionIds: [],
        rolledBackDraftSessionIds: [],
        retainedTerminalSnapshotIds: [],
        removedCandidateSnapshotIds: [],
        removedOrphanSnapshotIds: [],
      };
    },
  },
  projectionRecovery: stage(NOVEL_RECOVERY_PHASE.projection),
  outboxRecovery: {
    async dispatchPending() {
      calls.push(NOVEL_RECOVERY_PHASE.outbox);
      return {
        attemptedCount: 0,
        recordedCount: 0,
        duplicateCount: 0,
        alreadyPublishedCount: 0,
        removedTerminalSnapshotCount: 0,
        sourceResults: [],
      };
    },
  },
});
const first = application.recover();
const concurrent = application.recover();
assert.equal(first, concurrent);
const result = await first;
assert.equal(application.novelId, novelId);
assert.deepEqual(calls, [
  NOVEL_RECOVERY_PHASE.commit,
  NOVEL_RECOVERY_PHASE.rebase,
  NOVEL_RECOVERY_PHASE.draft,
  NOVEL_RECOVERY_PHASE.projection,
  NOVEL_RECOVERY_PHASE.outbox,
]);
assert.equal(result.phases.length, 5);
assert.equal(result.inspectedCount, 1);

assert.throws(
  () => createNodeNovelRecoveryApplication({
    novelId,
    commitRecovery: { async recover() { throw new Error("unused"); } },
    rebaseRecovery: stage(NOVEL_RECOVERY_PHASE.projection),
    draftRecovery: { async recoverDraftSessions() { throw new Error("unused"); } },
    projectionRecovery: stage(NOVEL_RECOVERY_PHASE.projection),
    outboxRecovery: { async dispatchPending() { throw new Error("unused"); } },
  }),
  /stage is invalid/u,
);

function stage(phase) {
  return {
    phase,
    async recover(receivedNovelId) {
      calls.push(phase);
      assert.equal(receivedNovelId, novelId);
      return {
        phase,
        inspectedCount: 0,
        repairedCount: 0,
        removedCount: 0,
        retainedCount: 0,
        publishedCount: 0,
      };
    },
  };
}

console.log("node novel recovery application smoke passed");
