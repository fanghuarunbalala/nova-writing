/** Adapts durable Commit history reconciliation into the unified recovery phase. */
import type { NovelCommitRecoveryResult } from "../commit/index.js";
import {
  captureNovelId,
  type NovelId,
} from "../identity/index.js";
import {
  NOVEL_RECOVERY_PHASE,
  captureNovelRecoveryPhaseResult,
  type NovelRecoveryPhaseResult,
} from "./NovelRecovery.js";
import type { NovelRecoveryStage } from "./NovelRecoveryCoordinator.js";

export interface NovelCommitRecoveryRunner {
  recover(novelId: NovelId): Promise<NovelCommitRecoveryResult>;
}

export class NovelCommitRecoveryStage implements NovelRecoveryStage {
  readonly phase = NOVEL_RECOVERY_PHASE.commit;

  constructor(private readonly runner: NovelCommitRecoveryRunner) {}

  async recover(novelIdInput: NovelId): Promise<NovelRecoveryPhaseResult> {
    const novelId = captureNovelId(novelIdInput);
    const result = captureCommitRecoveryResult(await this.runner.recover(novelId));
    return captureNovelRecoveryPhaseResult({
      phase: this.phase,
      inspectedCount: result.inspectedCount,
      repairedCount: result.recoveredCount,
      removedCount:
        result.removedTemporaryCount + result.removedOrphanCount,
      retainedCount: result.inspectedCount - result.recoveredCount,
      publishedCount: 0,
    });
  }
}

function captureCommitRecoveryResult(
  value: NovelCommitRecoveryResult,
): NovelCommitRecoveryResult {
  const inspectedCount = captureCount(value.inspectedCount);
  const recoveredCount = captureCount(value.recoveredCount);
  const removedTemporaryCount = captureCount(value.removedTemporaryCount);
  const removedOrphanCount = captureCount(value.removedOrphanCount);
  if (recoveredCount > inspectedCount) {
    throw new TypeError("Novel Commit recovery result is invalid");
  }
  return Object.freeze({
    inspectedCount,
    recoveredCount,
    removedTemporaryCount,
    removedOrphanCount,
  });
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("Novel Commit recovery result is invalid");
  }
  return value as number;
}
