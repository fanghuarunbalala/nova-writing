/** Durable identity for a sibling candidate rebuilt from a Resolution Plan. */
import { NOVEL_DRAFT_SESSION_STATUS, captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import { NOVEL_PROTOCOL_FAILURE, NovelProtocolValidationError } from "../error/index.js";
import { captureNovelDraftSessionId, type NovelDraftSessionId } from "../identity/index.js";
import { captureNovelTimestamp, type NovelTimestamp } from "../version/index.js";
import { captureNovelResolutionApplicationPlanDigest, type NovelResolutionApplicationPlanDigest } from "./NovelResolutionApplicationPlan.js";

export interface NovelResolvedRebaseCandidate {
  readonly sourceDraftSessionId: NovelDraftSessionId;
  readonly conflictedCandidateDraftSessionId: NovelDraftSessionId;
  readonly resolutionPlanDigest: NovelResolutionApplicationPlanDigest;
  readonly session: NovelDraftSession;
  readonly operationCount: number;
  readonly lastOperationSequence: number;
  readonly preparedAt: NovelTimestamp;
}

export interface NovelResolvedRebasePromotion {
  readonly sourceDraftSessionId: NovelDraftSessionId;
  readonly resolvedCandidateDraftSessionId: NovelDraftSessionId;
  readonly session: NovelDraftSession;
  readonly promotedAt: NovelTimestamp;
}

export interface NovelResolvedRebasePromotionResult {
  readonly status: "promoted" | "duplicate";
  readonly promotion: NovelResolvedRebasePromotion;
}

export function captureNovelResolvedRebaseCandidate(
  value: NovelResolvedRebaseCandidate,
): NovelResolvedRebaseCandidate {
  const session = captureNovelDraftSession(value.session);
  const sourceDraftSessionId = captureNovelDraftSessionId(value.sourceDraftSessionId);
  const conflictedCandidateDraftSessionId = captureNovelDraftSessionId(
    value.conflictedCandidateDraftSessionId,
  );
  if (
    session.status !== NOVEL_DRAFT_SESSION_STATUS.rebasing ||
    new Set([session.id, sourceDraftSessionId, conflictedCandidateDraftSessionId]).size !== 3 ||
    !Number.isSafeInteger(value.operationCount) ||
    value.operationCount < 0 ||
    value.operationCount !== value.lastOperationSequence
  ) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidRebaseCandidate,
      "rebaseCandidate",
    );
  }
  return Object.freeze({
    sourceDraftSessionId,
    conflictedCandidateDraftSessionId,
    resolutionPlanDigest: captureNovelResolutionApplicationPlanDigest(
      value.resolutionPlanDigest,
    ),
    session,
    operationCount: value.operationCount,
    lastOperationSequence: value.lastOperationSequence,
    preparedAt: captureNovelTimestamp(value.preparedAt),
  });
}

export function captureNovelResolvedRebasePromotion(
  value: NovelResolvedRebasePromotion,
): NovelResolvedRebasePromotion {
  const session = captureNovelDraftSession(value.session);
  const sourceDraftSessionId = captureNovelDraftSessionId(
    value.sourceDraftSessionId,
  );
  const resolvedCandidateDraftSessionId = captureNovelDraftSessionId(
    value.resolvedCandidateDraftSessionId,
  );
  if (
    session.status !== NOVEL_DRAFT_SESSION_STATUS.active ||
    session.id !== resolvedCandidateDraftSessionId ||
    session.id === sourceDraftSessionId
  ) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidRebaseCandidate,
      "rebasePromotion",
    );
  }
  return Object.freeze({
    sourceDraftSessionId,
    resolvedCandidateDraftSessionId,
    session,
    promotedAt: captureNovelTimestamp(value.promotedAt),
  });
}
