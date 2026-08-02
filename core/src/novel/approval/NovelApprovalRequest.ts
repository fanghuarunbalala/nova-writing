/** Content-safe human Approval request bound to one exact frozen ChangeSet. */
import { captureNovelConversationId } from "../draft/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelOperationId,
  type NovelDraftSessionId,
  type NovelId,
  type NovelOperationId,
} from "../identity/index.js";
import {
  captureNovelChangeSetDigest,
  type NovelChangeSet,
  type NovelChangeSetDigest,
} from "../commit/index.js";
import {
  captureNovelRevision,
  captureNovelTimestamp,
  type NovelRevision,
  type NovelTimestamp,
} from "../version/index.js";

export const NOVEL_APPROVAL_REQUEST_VERSION = 1 as const;

export interface NovelApprovalRequest {
  readonly requestVersion: typeof NOVEL_APPROVAL_REQUEST_VERSION;
  readonly approvalRequestId: string;
  readonly novelId: NovelId;
  readonly conversationId: string;
  readonly draftSessionId: NovelDraftSessionId;
  readonly baseRevision: NovelRevision;
  readonly changeSetDigest: NovelChangeSetDigest;
  readonly operationIds: readonly NovelOperationId[];
  readonly requestedAt: NovelTimestamp;
}

const REQUEST_ID = /^novel-approval:[A-Za-z0-9._:-]{1,160}:[0-9a-f]{64}$/u;

export function createNovelApprovalRequest(
  changeSet: NovelChangeSet,
  conversationId: string,
  requestedAt: NovelTimestamp,
): NovelApprovalRequest {
  return captureNovelApprovalRequest({
    requestVersion: NOVEL_APPROVAL_REQUEST_VERSION,
    approvalRequestId: createNovelApprovalRequestId(
      changeSet.draftSessionId,
      changeSet.digest,
    ),
    novelId: changeSet.novelId,
    conversationId,
    draftSessionId: changeSet.draftSessionId,
    baseRevision: changeSet.baseRevision,
    changeSetDigest: changeSet.digest,
    operationIds: changeSet.operations.map(
      (entry) => entry.operation.operationId,
    ),
    requestedAt,
  });
}

export function createNovelApprovalRequestId(
  draftSessionId: NovelDraftSessionId,
  changeSetDigest: NovelChangeSetDigest,
): string {
  const draftId = captureNovelDraftSessionId(draftSessionId);
  const digest = captureNovelChangeSetDigest(changeSetDigest);
  return `novel-approval:${draftId}:${digest.slice("sha256:".length)}`;
}

export function captureNovelApprovalRequest(
  value: NovelApprovalRequest,
): NovelApprovalRequest {
  const operationIds = Object.freeze(
    value.operationIds.map(captureNovelOperationId),
  );
  if (
    value.requestVersion !== NOVEL_APPROVAL_REQUEST_VERSION ||
    !REQUEST_ID.test(value.approvalRequestId) ||
    new Set(operationIds).size !== operationIds.length ||
    value.approvalRequestId !==
      createNovelApprovalRequestId(
        value.draftSessionId,
        value.changeSetDigest,
      )
  ) {
    throw invalid();
  }
  return Object.freeze({
    requestVersion: NOVEL_APPROVAL_REQUEST_VERSION,
    approvalRequestId: value.approvalRequestId,
    novelId: captureNovelId(value.novelId),
    conversationId: captureNovelConversationId(value.conversationId),
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    baseRevision: captureNovelRevision(value.baseRevision),
    changeSetDigest: captureNovelChangeSetDigest(value.changeSetDigest),
    operationIds,
    requestedAt: captureNovelTimestamp(value.requestedAt),
  });
}

function invalid(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidApproval,
    "approval",
  );
}
