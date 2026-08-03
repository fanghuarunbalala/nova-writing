/** Immutable summary of startup reconciliation for durable Draft Sessions. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelDraftSessionId,
  type NovelDraftSessionId,
} from "../identity/index.js";

export interface NovelDraftRecoveryResult {
  readonly recoveredDraftSessionIds: readonly NovelDraftSessionId[];
  readonly resetDraftSessionIds: readonly NovelDraftSessionId[];
  readonly rolledBackDraftSessionIds: readonly NovelDraftSessionId[];
  readonly removedTerminalSnapshotIds: readonly NovelDraftSessionId[];
  readonly removedCandidateSnapshotIds: readonly NovelDraftSessionId[];
  readonly removedOrphanSnapshotIds: readonly NovelDraftSessionId[];
}

export function captureNovelDraftRecoveryResult(
  value: NovelDraftRecoveryResult,
): NovelDraftRecoveryResult {
  const recoveredDraftSessionIds = captureUniqueDraftIds(
    value.recoveredDraftSessionIds,
  );
  const resetDraftSessionIds = captureUniqueDraftIds(value.resetDraftSessionIds);
  const rolledBackDraftSessionIds = captureUniqueDraftIds(
    value.rolledBackDraftSessionIds,
  );
  const removedOrphanSnapshotIds = captureUniqueDraftIds(
    value.removedOrphanSnapshotIds,
  );
  const removedTerminalSnapshotIds = captureUniqueDraftIds(
    value.removedTerminalSnapshotIds,
  );
  const removedCandidateSnapshotIds = captureUniqueDraftIds(
    value.removedCandidateSnapshotIds,
  );
  if (
    resetDraftSessionIds.some((id) => !recoveredDraftSessionIds.includes(id))
  ) {
    throw invalidDraftRecoveryResult();
  }
  const classifications = [
    ...recoveredDraftSessionIds,
    ...rolledBackDraftSessionIds,
    ...removedTerminalSnapshotIds,
    ...removedCandidateSnapshotIds,
    ...removedOrphanSnapshotIds,
  ];
  if (new Set(classifications).size !== classifications.length) {
    throw invalidDraftRecoveryResult();
  }
  return Object.freeze({
    recoveredDraftSessionIds,
    resetDraftSessionIds,
    rolledBackDraftSessionIds,
    removedTerminalSnapshotIds,
    removedCandidateSnapshotIds,
    removedOrphanSnapshotIds,
  });
}

function captureUniqueDraftIds(
  values: readonly NovelDraftSessionId[],
): readonly NovelDraftSessionId[] {
  const captured = values.map(captureNovelDraftSessionId);
  if (new Set(captured).size !== captured.length) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidIdentity,
      "draftSessionId",
    );
  }
  return Object.freeze(captured);
}

function invalidDraftRecoveryResult(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidIdentity,
    "draftSessionId",
  );
}
