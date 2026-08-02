/** Immutable human Approval bound to one exact Novel ChangeSet identity. */
import { canonicalStringifyJson, type JsonObject, type JsonValue } from "../../event/index.js";
import { NOVEL_PROTOCOL_FAILURE, NovelProtocolValidationError } from "../error/index.js";
import { captureNovelDraftSessionId, captureNovelOperationId, type NovelDraftSessionId, type NovelOperationId } from "../identity/index.js";
import { captureNovelChangeSetDigest, type NovelChangeSet, type NovelChangeSetDigest } from "../commit/index.js";
import { captureNovelRevision, captureNovelTimestamp, type NovelRevision, type NovelTimestamp } from "../version/index.js";

declare const novelApprovalDigestBrand: unique symbol;
export type NovelApprovalDigest = string & { readonly [novelApprovalDigestBrand]: "NovelApprovalDigest" };
export const NOVEL_CHANGE_SET_APPROVAL_VERSION = 1 as const;
export type NovelApprovalInvalidationReason =
  | "superseded"
  | "change-set-changed"
  | "base-revision-changed"
  | "draft-replaced"
  | "revoked";

export interface NovelChangeSetApprovalContent {
  readonly approvalVersion: typeof NOVEL_CHANGE_SET_APPROVAL_VERSION;
  readonly draftSessionId: NovelDraftSessionId;
  readonly baseRevision: NovelRevision;
  readonly changeSetDigest: NovelChangeSetDigest;
  readonly operationIds: readonly NovelOperationId[];
  readonly grantedAt: NovelTimestamp;
}
export interface NovelChangeSetApproval extends NovelChangeSetApprovalContent {
  readonly digest: NovelApprovalDigest;
}
export interface NovelApprovalDigester {
  readonly algorithm: "sha256";
  digest(value: NovelChangeSetApprovalContent): Promise<NovelApprovalDigest>;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
export function captureNovelApprovalDigest(value: unknown): NovelApprovalDigest {
  if (typeof value !== "string" || !DIGEST.test(value)) throw invalid();
  return value as NovelApprovalDigest;
}
export function captureNovelChangeSetApprovalContent(value: NovelChangeSetApprovalContent): NovelChangeSetApprovalContent {
  if (value.approvalVersion !== NOVEL_CHANGE_SET_APPROVAL_VERSION || !Array.isArray(value.operationIds)) throw invalid();
  const operationIds = Object.freeze(value.operationIds.map(captureNovelOperationId));
  if (new Set(operationIds).size !== operationIds.length) throw invalid();
  return Object.freeze({
    approvalVersion: NOVEL_CHANGE_SET_APPROVAL_VERSION,
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    baseRevision: captureNovelRevision(value.baseRevision),
    changeSetDigest: captureNovelChangeSetDigest(value.changeSetDigest),
    operationIds,
    grantedAt: captureNovelTimestamp(value.grantedAt),
  });
}
export function captureNovelChangeSetApproval(value: NovelChangeSetApproval): NovelChangeSetApproval {
  return Object.freeze({
    ...captureNovelChangeSetApprovalContent(value),
    digest: captureNovelApprovalDigest(value.digest),
  });
}
export function canonicalizeNovelChangeSetApprovalContent(value: NovelChangeSetApprovalContent): string {
  const approval = captureNovelChangeSetApprovalContent(value);
  return canonicalStringifyJson({
    approvalVersion: approval.approvalVersion,
    draftSessionId: approval.draftSessionId,
    baseRevision: approval.baseRevision,
    changeSetDigest: approval.changeSetDigest,
    operationIds: [...approval.operationIds] as JsonValue[],
    grantedAt: approval.grantedAt,
  });
}
export function canonicalizeNovelChangeSetApproval(value: NovelChangeSetApproval): string {
  const approval = captureNovelChangeSetApproval(value);
  return canonicalStringifyJson({
    ...(JSON.parse(canonicalizeNovelChangeSetApprovalContent(approval)) as JsonObject),
    digest: approval.digest,
  });
}
export function approvalMatchesChangeSet(approval: NovelChangeSetApproval, changeSet: NovelChangeSet): boolean {
  const captured = captureNovelChangeSetApproval(approval);
  return captured.draftSessionId === changeSet.draftSessionId &&
    captured.baseRevision === changeSet.baseRevision &&
    captured.changeSetDigest === changeSet.digest &&
    captured.operationIds.length === changeSet.operations.length &&
    captured.operationIds.every((id, index) => id === changeSet.operations[index]?.operation.operationId);
}
function invalid(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidApproval,
    "approval",
  );
}
