/** Immutable summary of startup reconciliation for durable Draft Sessions. */
import type { NovelDraftSessionId } from "../identity/index.js";

export interface NovelDraftRecoveryResult {
  readonly recoveredDraftSessionIds: readonly NovelDraftSessionId[];
  readonly rolledBackDraftSessionIds: readonly NovelDraftSessionId[];
  readonly removedOrphanSnapshotIds: readonly NovelDraftSessionId[];
}

export function captureNovelDraftRecoveryResult(
  value: NovelDraftRecoveryResult,
): NovelDraftRecoveryResult {
  return Object.freeze({
    recoveredDraftSessionIds: Object.freeze([
      ...value.recoveredDraftSessionIds,
    ]),
    rolledBackDraftSessionIds: Object.freeze([
      ...value.rolledBackDraftSessionIds,
    ]),
    removedOrphanSnapshotIds: Object.freeze([
      ...value.removedOrphanSnapshotIds,
    ]),
  });
}
