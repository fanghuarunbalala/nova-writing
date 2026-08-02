/** SHA-256 identity contract for frozen ordered Novel ChangeSets. */
import { NOVEL_PROTOCOL_FAILURE, NovelProtocolValidationError } from "../error/index.js";
import type { NovelChangeSetIdentity } from "./NovelChangeSet.js";

declare const novelChangeSetDigestBrand: unique symbol;

export type NovelChangeSetDigest = string & {
  readonly [novelChangeSetDigestBrand]: "NovelChangeSetDigest";
};

export interface NovelChangeSetDigester {
  readonly algorithm: "sha256";
  digest(changeSet: NovelChangeSetIdentity): Promise<NovelChangeSetDigest>;
}

const CHANGE_SET_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function captureNovelChangeSetDigest(value: unknown): NovelChangeSetDigest {
  if (typeof value !== "string" || !CHANGE_SET_DIGEST.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidChangeSetDigest,
      "changeSetDigest",
    );
  }
  return value as NovelChangeSetDigest;
}
