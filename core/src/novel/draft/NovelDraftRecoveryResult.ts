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
  readonly rolledBackDraftSessionIds: readonly NovelDraftSessionId[];
  readonly removedOrphanSnapshotIds: readonly NovelDraftSessionId[];
}

export function captureNovelDraftRecoveryResult(
  value: NovelDraftRecoveryResult,
): NovelDraftRecoveryResult {
  const recoveredDraftSessionIds = captureUniqueDraftIds(
    value.recoveredDraftSessionIds,
  );
  const rolledBackDraftSessionIds = captureUniqueDraftIds(
    value.rolledBackDraftSessionIds,
  );
  const removedOrphanSnapshotIds = captureUniqueDraftIds(
    value.removedOrphanSnapshotIds,
  );
  const classifications = [
    ...recoveredDraftSessionIds,
    ...rolledBackDraftSessionIds,
    ...removedOrphanSnapshotIds,
  ];
  if (new Set(classifications).size !== classifications.length) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidIdentity,
      "draftSessionId",
    );
  }
  return Object.freeze({
    recoveredDraftSessionIds,
    rolledBackDraftSessionIds,
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
