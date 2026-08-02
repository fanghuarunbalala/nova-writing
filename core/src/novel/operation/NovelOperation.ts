/** Immutable, versioned Domain Operation envelope containing only JSON data. */
import {
  canonicalStringifyJson,
  type JsonObject,
} from "../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelOperationId,
  type NovelOperationId,
} from "../identity/index.js";
import {
  captureNovelEntityVersion,
  captureNovelOperationVersion,
  type NovelEntityVersion,
  type NovelOperationVersion,
} from "../version/index.js";

export type NovelOperationPrecondition =
  | NovelEntityExistsPrecondition
  | NovelEntityAbsentPrecondition
  | NovelEntityVersionPrecondition
  | NovelFieldDigestPrecondition;

interface NovelOperationPreconditionBase {
  readonly entityType: string;
  readonly entityId: string;
}

export interface NovelEntityExistsPrecondition
  extends NovelOperationPreconditionBase {
  readonly kind: "entity-exists";
}

export interface NovelEntityAbsentPrecondition
  extends NovelOperationPreconditionBase {
  readonly kind: "entity-absent";
}

export interface NovelEntityVersionPrecondition
  extends NovelOperationPreconditionBase {
  readonly kind: "entity-version";
  readonly expectedEntityVersion: NovelEntityVersion;
}

export interface NovelFieldDigestPrecondition
  extends NovelOperationPreconditionBase {
  readonly kind: "field-digest";
  readonly fieldPath: string;
  readonly expectedDigest: string;
}

export interface NovelOperation<
  TType extends string = string,
  TPayload extends JsonObject = JsonObject,
> {
  readonly operationId: NovelOperationId;
  readonly operationVersion: NovelOperationVersion;
  readonly type: TType;
  readonly expected: readonly NovelOperationPrecondition[];
  readonly payload: TPayload;
}

const SAFE_OPERATION_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,15}$/u;
const SAFE_ENTITY_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,15}$/u;
const SAFE_ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_FIELD_PATH = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){0,31}$/u;
const SAFE_DIGEST_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export function captureNovelOperation<
  TType extends string,
  TPayload extends JsonObject,
>(value: NovelOperation<TType, TPayload>): NovelOperation<TType, TPayload> {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.expected)
  ) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperation,
      "operationPayload",
    );
  }
  const type = captureOperationType(value.type) as TType;
  const payload = captureJsonObject(value.payload) as TPayload;
  return Object.freeze({
    operationId: captureNovelOperationId(value.operationId),
    operationVersion: captureNovelOperationVersion(value.operationVersion),
    type,
    expected: Object.freeze(value.expected.map(capturePrecondition)),
    payload,
  });
}

export function captureOperationType(value: unknown): string {
  if (typeof value !== "string" || !SAFE_OPERATION_TYPE.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperation,
      "operationType",
    );
  }
  return value;
}

function capturePrecondition(
  value: NovelOperationPrecondition,
): NovelOperationPrecondition {
  const base = {
    entityType: captureToken(value.entityType, SAFE_ENTITY_TYPE),
    entityId: captureToken(value.entityId, SAFE_ENTITY_ID),
  };
  switch (value.kind) {
    case "entity-exists":
    case "entity-absent":
      return Object.freeze({ ...base, kind: value.kind });
    case "entity-version":
      return Object.freeze({
        ...base,
        kind: value.kind,
        expectedEntityVersion: captureNovelEntityVersion(
          value.expectedEntityVersion,
        ),
      });
    case "field-digest":
      return Object.freeze({
        ...base,
        kind: value.kind,
        fieldPath: captureToken(value.fieldPath, SAFE_FIELD_PATH),
        expectedDigest: captureToken(value.expectedDigest, SAFE_DIGEST_TOKEN),
      });
    default:
      throw new NovelProtocolValidationError(
        NOVEL_PROTOCOL_FAILURE.invalidOperation,
        "operationPrecondition",
      );
  }
}

function captureJsonObject(value: JsonObject): JsonObject {
  let canonical: string;
  try {
    canonical = canonicalStringifyJson(value);
  } catch {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperation,
      "operationPayload",
    );
  }
  return deepFreezeJson(JSON.parse(canonical) as JsonObject);
}

function deepFreezeJson<T extends JsonObject>(value: T): T {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") {
      if (Array.isArray(nested)) {
        for (const item of nested) {
          if (item !== null && typeof item === "object") {
            deepFreezeJson(item as JsonObject);
          }
        }
        Object.freeze(nested);
      } else {
        deepFreezeJson(nested);
      }
    }
  }
  return Object.freeze(value);
}

function captureToken(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperation,
      "operationPrecondition",
    );
  }
  return value;
}
