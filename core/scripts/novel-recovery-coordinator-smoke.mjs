import assert from "node:assert/strict";
import {
  NOVEL_RECOVERY_PHASE,
  NOVEL_RECOVERY_PHASE_ORDER,
  NovelRecoveryCoordinator,
  NovelRecoveryPhaseError,
  captureNovelId,
  captureNovelRecoveryResult,
} from "../dist/index.js";

const novelId = captureNovelId("novel_recovery_coordinator");
const calls = [];
let releaseCommit;
const commitGate = new Promise((resolve) => {
  releaseCommit = resolve;
});
const stages = NOVEL_RECOVERY_PHASE_ORDER.toReversed().map((phase) => ({
  phase,
  async recover(receivedNovelId) {
    assert.equal(receivedNovelId, novelId);
    calls.push(phase);
    if (phase === NOVEL_RECOVERY_PHASE.commit) await commitGate;
    return {
      phase,
      inspectedCount: 2,
      repairedCount: phase === NOVEL_RECOVERY_PHASE.projection ? 2 : 1,
      removedCount: phase === NOVEL_RECOVERY_PHASE.draft ? 1 : 0,
      retainedCount: phase === NOVEL_RECOVERY_PHASE.rebase ? 1 : 0,
      publishedCount: phase === NOVEL_RECOVERY_PHASE.outbox ? 3 : 0,
    };
  },
}));
const coordinator = new NovelRecoveryCoordinator({ stages });
const first = coordinator.recover(novelId);
const concurrent = coordinator.recover(novelId);
assert.equal(first, concurrent);
await assert.rejects(
  coordinator.recover(captureNovelId("novel_recovery_other")),
  /already active/u,
);
assert.deepEqual(calls, [NOVEL_RECOVERY_PHASE.commit]);
releaseCommit();
const result = await first;
assert.deepEqual(calls, NOVEL_RECOVERY_PHASE_ORDER);
assert.equal(result.inspectedCount, 10);
assert.equal(result.repairedCount, 6);
assert.equal(result.removedCount, 1);
assert.equal(result.retainedCount, 1);
assert.equal(result.publishedCount, 3);
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.phases));

const retryCalls = [];
await coordinator.recover(novelId);
assert.deepEqual(calls.slice(NOVEL_RECOVERY_PHASE_ORDER.length), NOVEL_RECOVERY_PHASE_ORDER);

let failCommit = true;
const failing = new NovelRecoveryCoordinator({
  stages: NOVEL_RECOVERY_PHASE_ORDER.map((phase) => ({
    phase,
    async recover() {
      retryCalls.push(phase);
      if (phase === NOVEL_RECOVERY_PHASE.rebase && failCommit) throw new Error("private");
      return {
        phase,
        inspectedCount: 0,
        repairedCount: 0,
        removedCount: 0,
        retainedCount: 0,
        publishedCount: 0,
      };
    },
  })),
});
await assert.rejects(
  failing.recover(novelId),
  (error) =>
    error instanceof NovelRecoveryPhaseError &&
    error.phase === NOVEL_RECOVERY_PHASE.rebase &&
    !error.message.includes("private"),
);
assert.deepEqual(retryCalls, [
  NOVEL_RECOVERY_PHASE.commit,
  NOVEL_RECOVERY_PHASE.rebase,
]);
failCommit = false;
await failing.recover(novelId);
assert.deepEqual(retryCalls.slice(2), NOVEL_RECOVERY_PHASE_ORDER);

assert.throws(
  () => new NovelRecoveryCoordinator({ stages: stages.slice(1) }),
  /stages are invalid/u,
);
assert.throws(
  () => new NovelRecoveryCoordinator({ stages: [...stages, stages[0]] }),
  /stages are invalid/u,
);
assert.throws(
  () => captureNovelRecoveryResult({ ...result, repairedCount: 99 }),
  /result is invalid/u,
);

console.log("novel recovery coordinator smoke passed");
