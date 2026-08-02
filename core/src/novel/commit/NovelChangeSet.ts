/** Frozen ordered Draft Operation sequence used by Commit and Approval identity. */
import { canonicalStringifyJson, type JsonObject, type JsonValue } from "../../event/index.js";
import { NOVEL_INVARIANT_FAILURE, NovelInvariantViolationError } from "../error/index.js";
import {
  captureNovelDraftSessionId,
  captureNovelId,
  type NovelDraftSessionId,
  type NovelId,
} from "../identity/index.js";
import {
  captureNovelOperation,
  captureNovelOperationDigest,
  type NovelOperation,
  type NovelOperationDigest,
} from "../operation/index.js";
import { captureNovelRevision, captureNovelTimestamp, type NovelRevision, type NovelTimestamp } from "../version/index.js";
import { captureNovelChangeSetDigest, type NovelChangeSetDigest } from "./NovelChangeSetDigest.js";

export const NOVEL_CHANGE_SET_VERSION = 1 as const;

export interface NovelChangeSetOperation {
  readonly sequence: number;
  readonly operation: NovelOperation;
  readonly operationDigest: NovelOperationDigest;
}

export interface NovelChangeSetIdentity {
  readonly changeSetVersion: typeof NOVEL_CHANGE_SET_VERSION;
  readonly novelId: NovelId;
  readonly baseRevision: NovelRevision;
  readonly operationCount: number;
  readonly lastOperationSequence: number;
  readonly operations: readonly NovelChangeSetOperation[];
}

export interface NovelChangeSet extends NovelChangeSetIdentity {
  readonly draftSessionId: NovelDraftSessionId;
  readonly digest: NovelChangeSetDigest;
  readonly frozenAt: NovelTimestamp;
}

export function captureNovelChangeSetIdentity(
  value: NovelChangeSetIdentity,
): NovelChangeSetIdentity {
  const operations = captureOperations(value.operations);
  const operationCount = captureCount(value.operationCount);
  const lastOperationSequence = captureCount(value.lastOperationSequence);
  if (
    value.changeSetVersion !== NOVEL_CHANGE_SET_VERSION ||
    operationCount !== operations.length ||
    lastOperationSequence !== (operations.at(-1)?.sequence ?? 0)
  ) {
    throw invalidChangeSet();
  }
  return Object.freeze({
    changeSetVersion: NOVEL_CHANGE_SET_VERSION,
    novelId: captureNovelId(value.novelId),
    baseRevision: captureNovelRevision(value.baseRevision),
    operationCount,
    lastOperationSequence,
    operations,
  });
}

export function captureNovelChangeSet(value: NovelChangeSet): NovelChangeSet {
  const identity = captureNovelChangeSetIdentity(value);
  return Object.freeze({
    ...identity,
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    digest: captureNovelChangeSetDigest(value.digest),
    frozenAt: captureNovelTimestamp(value.frozenAt),
  });
}

export function canonicalizeNovelChangeSetIdentity(
  value: NovelChangeSetIdentity,
): string {
  const captured = captureNovelChangeSetIdentity(value);
  const envelope: JsonObject = {
    changeSetVersion: captured.changeSetVersion,
    novelId: captured.novelId,
    baseRevision: captured.baseRevision,
    operationCount: captured.operationCount,
    lastOperationSequence: captured.lastOperationSequence,
    operations: captured.operations.map((entry) => ({
      sequence: entry.sequence,
      operationDigest: entry.operationDigest,
    })) as JsonValue[],
  };
  return canonicalStringifyJson(envelope);
}

function captureOperations(
  values: readonly NovelChangeSetOperation[],
): readonly NovelChangeSetOperation[] {
  if (!Array.isArray(values)) throw invalidChangeSet();
  return Object.freeze(values.map((value, index) => {
    const sequence = captureSequence(value.sequence);
    if (sequence !== index + 1) throw invalidChangeSet();
    return Object.freeze({
      sequence,
      operation: captureNovelOperation(value.operation),
      operationDigest: captureNovelOperationDigest(value.operationDigest),
    });
  }));
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidChangeSet();
  }
  return value as number;
}

function captureSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidChangeSet();
  }
  return value as number;
}

function invalidChangeSet(): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
  );
}
