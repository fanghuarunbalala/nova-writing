/** Immutable metadata for a fully replayed sibling Rebase candidate. */
import {
  NOVEL_DRAFT_SESSION_STATUS,
  captureNovelDraftSession,
  type NovelDraftSession,
} from "../draft/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelDraftSessionId,
  type NovelDraftSessionId,
} from "../identity/index.js";
import {
  captureNovelRevision,
  captureNovelTimestamp,
  type NovelRevision,
  type NovelTimestamp,
} from "../version/index.js";

export interface NovelRebaseCandidate {
  readonly sourceDraftSessionId: NovelDraftSessionId;
  readonly sourceBaseRevision: NovelRevision;
  readonly session: NovelDraftSession;
  readonly operationCount: number;
  readonly lastOperationSequence: number;
  readonly preparedAt: NovelTimestamp;
}

export function captureNovelRebaseCandidate(
  value: NovelRebaseCandidate,
): NovelRebaseCandidate {
  const session = captureNovelDraftSession(value.session);
  const sourceDraftSessionId = captureNovelDraftSessionId(
    value.sourceDraftSessionId,
  );
  const sourceBaseRevision = captureNovelRevision(value.sourceBaseRevision);
  const operationCount = captureCount(value.operationCount, "operationCount");
  const lastOperationSequence = captureCount(
    value.lastOperationSequence,
    "lastOperationSequence",
  );
  if (
    session.status !== NOVEL_DRAFT_SESSION_STATUS.rebasing ||
    session.id === sourceDraftSessionId ||
    session.baseRevision === sourceBaseRevision ||
    operationCount !== lastOperationSequence
  ) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidRebaseCandidate,
      "rebaseCandidate",
    );
  }
  return Object.freeze({
    sourceDraftSessionId,
    sourceBaseRevision,
    session,
    operationCount,
    lastOperationSequence,
    preparedAt: captureNovelTimestamp(value.preparedAt),
  });
}

function captureCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidRebaseCandidate,
      field,
    );
  }
  return value as number;
}
