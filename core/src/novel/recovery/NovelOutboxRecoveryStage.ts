/** Adapts deterministic canonical/Draft Outbox retry into the final recovery phase. */
import type { NovelId } from "../identity/index.js";
import type { NovelOutboxCoordinatedDispatchResult } from "../outbox/index.js";
import {
  NOVEL_RECOVERY_PHASE,
  captureNovelRecoveryPhaseResult,
  type NovelRecoveryPhaseResult,
} from "./NovelRecovery.js";
import type { NovelRecoveryStage } from "./NovelRecoveryCoordinator.js";

export interface NovelOutboxRecoveryRunner {
  dispatchPending(): Promise<NovelOutboxCoordinatedDispatchResult>;
}

export class NovelOutboxRecoveryStage implements NovelRecoveryStage {
  readonly phase = NOVEL_RECOVERY_PHASE.outbox;

  constructor(private readonly runner: NovelOutboxRecoveryRunner) {}

  async recover(_novelId: NovelId): Promise<NovelRecoveryPhaseResult> {
    const result = captureDispatchResult(await this.runner.dispatchPending());
    return captureNovelRecoveryPhaseResult({
      phase: this.phase,
      inspectedCount: result.attemptedCount + result.alreadyPublishedCount,
      repairedCount: result.duplicateCount,
      removedCount: 0,
      retainedCount: result.alreadyPublishedCount,
      publishedCount: result.recordedCount + result.duplicateCount,
    });
  }
}

function captureDispatchResult(
  value: NovelOutboxCoordinatedDispatchResult,
): NovelOutboxCoordinatedDispatchResult {
  const attemptedCount = captureCount(value.attemptedCount);
  const recordedCount = captureCount(value.recordedCount);
  const duplicateCount = captureCount(value.duplicateCount);
  const alreadyPublishedCount = captureCount(value.alreadyPublishedCount);
  if (attemptedCount !== recordedCount + duplicateCount) {
    throw new TypeError("Novel Outbox recovery result is invalid");
  }
  return Object.freeze({
    attemptedCount,
    recordedCount,
    duplicateCount,
    alreadyPublishedCount,
    sourceResults: Object.freeze([...value.sourceResults]),
  });
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("Novel Outbox recovery result is invalid");
  }
  return value as number;
}
