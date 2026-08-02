/** SHA-256 identity shared by conflict snapshots and conflict records. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";

declare const novelConflictDigestBrand: unique symbol;

export type NovelConflictDigest = string & {
  readonly [novelConflictDigestBrand]: "NovelConflictDigest";
};

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function captureNovelConflictDigest(
  value: unknown,
): NovelConflictDigest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidConflictDigest,
      "conflictDigest",
    );
  }
  return value as NovelConflictDigest;
}
