/** Distinct opaque Novel revision and numeric schema/entity version contracts. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";

declare const novelRevisionBrand: unique symbol;
declare const novelSchemaVersionBrand: unique symbol;
declare const novelEntityVersionBrand: unique symbol;
declare const novelOperationVersionBrand: unique symbol;
declare const novelTimestampBrand: unique symbol;

export type NovelRevision = string & {
  readonly [novelRevisionBrand]: "NovelRevision";
};
export type NovelSchemaVersion = number & {
  readonly [novelSchemaVersionBrand]: "NovelSchemaVersion";
};
export type NovelEntityVersion = number & {
  readonly [novelEntityVersionBrand]: "NovelEntityVersion";
};
export type NovelOperationVersion = number & {
  readonly [novelOperationVersionBrand]: "NovelOperationVersion";
};
export type NovelTimestamp = string & {
  readonly [novelTimestampBrand]: "NovelTimestamp";
};

const SAFE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export function captureNovelRevision(value: unknown): NovelRevision {
  if (typeof value !== "string" || !SAFE_REVISION_PATTERN.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidRevision,
      "revision",
    );
  }
  return value as NovelRevision;
}

export function captureNovelSchemaVersion(value: unknown): NovelSchemaVersion {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidSchemaVersion,
      "schemaVersion",
    );
  }
  return value as NovelSchemaVersion;
}

export function captureNovelEntityVersion(value: unknown): NovelEntityVersion {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidEntityVersion,
      "entityVersion",
    );
  }
  return value as NovelEntityVersion;
}

export function captureNovelOperationVersion(value: unknown): NovelOperationVersion {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperationVersion,
      "operationVersion",
    );
  }
  return value as NovelOperationVersion;
}

export function captureNovelTimestamp(value: unknown): NovelTimestamp {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidTimestamp,
      "timestamp",
    );
  }
  return value as NovelTimestamp;
}
