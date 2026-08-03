/** Adapts Draft snapshot reconciliation into the unified recovery phase. */
import {
  captureNovelDraftRecoveryResult,
  type NovelDraftRecoveryResult,
} from "../draft/index.js";
import type { NovelId } from "../identity/index.js";
import {
  NOVEL_RECOVERY_PHASE,
  captureNovelRecoveryPhaseResult,
  type NovelRecoveryPhaseResult,
} from "./NovelRecovery.js";
import type { NovelRecoveryStage } from "./NovelRecoveryCoordinator.js";

export interface NovelDraftRecoveryRunner {
  recoverDraftSessions(): Promise<NovelDraftRecoveryResult>;
}

export class NovelDraftRecoveryStage implements NovelRecoveryStage {
  readonly phase = NOVEL_RECOVERY_PHASE.draft;

  constructor(private readonly runner: NovelDraftRecoveryRunner) {}

  async recover(_novelId: NovelId): Promise<NovelRecoveryPhaseResult> {
    const result = captureNovelDraftRecoveryResult(
      await this.runner.recoverDraftSessions(),
    );
    const resetCount = result.resetDraftSessionIds.length;
    return captureNovelRecoveryPhaseResult({
      phase: this.phase,
      inspectedCount:
        result.recoveredDraftSessionIds.length +
        result.rolledBackDraftSessionIds.length +
        result.removedTerminalSnapshotIds.length +
        result.removedCandidateSnapshotIds.length +
        result.removedOrphanSnapshotIds.length,
      repairedCount: resetCount + result.rolledBackDraftSessionIds.length,
      removedCount:
        result.removedTerminalSnapshotIds.length +
        result.removedCandidateSnapshotIds.length +
        result.removedOrphanSnapshotIds.length,
      retainedCount: result.recoveredDraftSessionIds.length - resetCount,
      publishedCount: 0,
    });
  }
}
