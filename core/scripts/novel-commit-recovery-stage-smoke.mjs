import assert from "node:assert/strict";
import {
  NOVEL_RECOVERY_PHASE,
  NovelCommitRecoveryStage,
  captureNovelId,
} from "../dist/index.js";

const novelId = captureNovelId("novel_commit_recovery_stage");
const stage = new NovelCommitRecoveryStage({
  async recover(receivedNovelId) {
    assert.equal(receivedNovelId, novelId);
    return {
      inspectedCount: 4,
      recoveredCount: 1,
      removedTemporaryCount: 2,
      removedOrphanCount: 1,
    };
  },
});

assert.deepEqual(await stage.recover(novelId), {
  phase: NOVEL_RECOVERY_PHASE.commit,
  inspectedCount: 4,
  repairedCount: 1,
  removedCount: 3,
  retainedCount: 3,
  publishedCount: 0,
});
await assert.rejects(
  new NovelCommitRecoveryStage({
    async recover() {
      return {
        inspectedCount: 1,
        recoveredCount: 2,
        removedTemporaryCount: 0,
        removedOrphanCount: 0,
      };
    },
  }).recover(novelId),
  /result is invalid/u,
);

console.log("novel commit recovery stage smoke passed");
