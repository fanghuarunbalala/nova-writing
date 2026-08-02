/** Canonical immutable history payload for one accepted Novel Commit. */
import { canonicalStringifyJson, type JsonObject, type JsonValue } from "../../event/index.js";
import { captureNovelConversationId } from "../draft/index.js";
import { NOVEL_INVARIANT_FAILURE, NovelInvariantViolationError } from "../error/index.js";
import {
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelId,
  type NovelCommitId,
  type NovelDraftSessionId,
  type NovelId,
} from "../identity/index.js";
import {
  canonicalizeNovelOperation,
  captureNovelOperation,
  captureNovelOperationDigest,
  type NovelOperation,
  type NovelOperationDigest,
} from "../operation/index.js";
import { captureNovelRevision, captureNovelTimestamp, type NovelRevision, type NovelTimestamp } from "../version/index.js";
import { captureNovelChangeSetDigest, type NovelChangeSetDigest } from "./NovelChangeSetDigest.js";

export const NOVEL_COMMIT_PAYLOAD_VERSION = 1 as const;

export interface NovelCommitPayloadOperation {
  readonly sequence: number;
  readonly operationDigest: NovelOperationDigest;
  readonly operation: NovelOperation;
}

export interface NovelCommitPayload {
  readonly payloadVersion: typeof NOVEL_COMMIT_PAYLOAD_VERSION;
  readonly commitId: NovelCommitId;
  readonly novelId: NovelId;
  readonly draftSessionId: NovelDraftSessionId;
  readonly ownerConversationId: string;
  readonly baseRevision: NovelRevision;
  readonly resultRevision: NovelRevision;
  readonly changeSetDigest: NovelChangeSetDigest;
  readonly operationCount: number;
  readonly committedAt: NovelTimestamp;
  readonly operations: readonly NovelCommitPayloadOperation[];
}

export function captureNovelCommitPayload(value: NovelCommitPayload): NovelCommitPayload {
  const novelId = captureNovelId(value.novelId);
  const operations = captureOperations(value.operations, novelId);
  if (
    value.payloadVersion !== NOVEL_COMMIT_PAYLOAD_VERSION ||
    !Number.isSafeInteger(value.operationCount) ||
    value.operationCount < 0 ||
    value.operationCount !== operations.length
  ) {
    throw invalidPayload(novelId);
  }
  return Object.freeze({
    payloadVersion: NOVEL_COMMIT_PAYLOAD_VERSION,
    commitId: captureNovelCommitId(value.commitId),
    novelId,
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    ownerConversationId: captureNovelConversationId(value.ownerConversationId),
    baseRevision: captureNovelRevision(value.baseRevision),
    resultRevision: captureNovelRevision(value.resultRevision),
    changeSetDigest: captureNovelChangeSetDigest(value.changeSetDigest),
    operationCount: value.operationCount,
    committedAt: captureNovelTimestamp(value.committedAt),
    operations,
  });
}

export function canonicalizeNovelCommitPayload(value: NovelCommitPayload): string {
  const payload = captureNovelCommitPayload(value);
  const envelope: JsonObject = {
    payloadVersion: payload.payloadVersion,
    commitId: payload.commitId,
    novelId: payload.novelId,
    draftSessionId: payload.draftSessionId,
    ownerConversationId: payload.ownerConversationId,
    baseRevision: payload.baseRevision,
    resultRevision: payload.resultRevision,
    changeSetDigest: payload.changeSetDigest,
    operationCount: payload.operationCount,
    committedAt: payload.committedAt,
    operations: payload.operations.map((entry) => ({
      sequence: entry.sequence,
      operationDigest: entry.operationDigest,
      operation: JSON.parse(canonicalizeNovelOperation(entry.operation)) as JsonValue,
    })) as JsonValue[],
  };
  return canonicalStringifyJson(envelope);
}

function captureOperations(
  values: readonly NovelCommitPayloadOperation[],
  novelId: NovelId,
): readonly NovelCommitPayloadOperation[] {
  if (!Array.isArray(values)) throw invalidPayload(novelId);
  return Object.freeze(values.map((value, index) => {
    if (!Number.isSafeInteger(value.sequence) || value.sequence !== index + 1) {
      throw invalidPayload(novelId);
    }
    return Object.freeze({
      sequence: value.sequence,
      operationDigest: captureNovelOperationDigest(value.operationDigest),
      operation: captureNovelOperation(value.operation),
    });
  }));
}

function invalidPayload(novelId?: NovelId): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    novelId,
  );
}
