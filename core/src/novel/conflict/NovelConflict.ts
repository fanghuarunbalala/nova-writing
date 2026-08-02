/** Digest-only semantic conflict records safe for persistence and events. */
import { canonicalStringifyJson, type JsonObject } from "../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelConflictId,
  captureNovelDraftSessionId,
  captureNovelOperationId,
  type NovelConflictId,
  type NovelDraftSessionId,
  type NovelOperationId,
} from "../identity/index.js";
import {
  captureNovelTimestamp,
  type NovelTimestamp,
} from "../version/index.js";
import {
  captureNovelConflictDigest,
  type NovelConflictDigest,
} from "./NovelConflictDigest.js";

export const NOVEL_CONFLICT_VERSION = 1 as const;

export type NovelConflictKind =
  | "field-modified"
  | "entity-deleted"
  | "entity-created"
  | "parent-changed"
  | "order-changed"
  | "manuscript-block-modified"
  | "domain-invariant";

export interface NovelConflict {
  readonly conflictVersion: typeof NOVEL_CONFLICT_VERSION;
  readonly id: NovelConflictId;
  readonly draftSessionId: NovelDraftSessionId;
  readonly operationId: NovelOperationId;
  readonly sourceOperationSequence: number;
  readonly status: "unresolved";
  readonly kind: NovelConflictKind;
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldPath?: string;
  readonly baseDigest: NovelConflictDigest;
  readonly canonicalDigest: NovelConflictDigest;
  readonly draftDigest: NovelConflictDigest;
  readonly createdAt: NovelTimestamp;
}

export interface NovelConflictRecord {
  readonly conflict: NovelConflict;
  readonly digest: NovelConflictDigest;
}

const KINDS = new Set<unknown>([
  "field-modified",
  "entity-deleted",
  "entity-created",
  "parent-changed",
  "order-changed",
  "manuscript-block-modified",
  "domain-invariant",
]);
const SAFE_ENTITY_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,15}$/u;
const SAFE_ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_FIELD_PATH = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){0,31}$/u;

export function captureNovelConflict(value: NovelConflict): NovelConflict {
  if (
    value.conflictVersion !== NOVEL_CONFLICT_VERSION ||
    value.status !== "unresolved" ||
    !KINDS.has(value.kind)
  ) {
    throw invalidConflict();
  }
  const fieldPath = value.fieldPath === undefined
    ? undefined
    : captureToken(value.fieldPath, SAFE_FIELD_PATH);
  return Object.freeze({
    conflictVersion: NOVEL_CONFLICT_VERSION,
    id: captureNovelConflictId(value.id),
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    operationId: captureNovelOperationId(value.operationId),
    sourceOperationSequence: captureSequence(value.sourceOperationSequence),
    status: "unresolved",
    kind: value.kind,
    entityType: captureToken(value.entityType, SAFE_ENTITY_TYPE),
    entityId: captureToken(value.entityId, SAFE_ENTITY_ID),
    ...(fieldPath === undefined ? {} : { fieldPath }),
    baseDigest: captureNovelConflictDigest(value.baseDigest),
    canonicalDigest: captureNovelConflictDigest(value.canonicalDigest),
    draftDigest: captureNovelConflictDigest(value.draftDigest),
    createdAt: captureNovelTimestamp(value.createdAt),
  });
}

export function captureNovelConflictRecord(
  value: NovelConflictRecord,
): NovelConflictRecord {
  return Object.freeze({
    conflict: captureNovelConflict(value.conflict),
    digest: captureNovelConflictDigest(value.digest),
  });
}

export function canonicalizeNovelConflict(value: NovelConflict): string {
  const conflict = captureNovelConflict(value);
  const envelope: JsonObject = {
    conflictVersion: conflict.conflictVersion,
    id: conflict.id,
    draftSessionId: conflict.draftSessionId,
    operationId: conflict.operationId,
    sourceOperationSequence: conflict.sourceOperationSequence,
    status: conflict.status,
    kind: conflict.kind,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    ...(conflict.fieldPath === undefined
      ? {}
      : { fieldPath: conflict.fieldPath }),
    baseDigest: conflict.baseDigest,
    canonicalDigest: conflict.canonicalDigest,
    draftDigest: conflict.draftDigest,
    createdAt: conflict.createdAt,
  };
  return canonicalStringifyJson(envelope);
}

function captureSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidConflict();
  }
  return value as number;
}

function captureToken(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw invalidConflict();
  }
  return value;
}

function invalidConflict(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidConflict,
    "conflict",
  );
}
