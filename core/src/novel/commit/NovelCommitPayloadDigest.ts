/** Safe identities for immutable Novel Commit history payload files. */
import { NOVEL_PROTOCOL_FAILURE, NovelProtocolValidationError } from "../error/index.js";
import { captureNovelCommitId, type NovelCommitId } from "../identity/index.js";

declare const payloadDigestBrand: unique symbol;
declare const payloadRefBrand: unique symbol;

export type NovelCommitPayloadDigest = string & {
  readonly [payloadDigestBrand]: "NovelCommitPayloadDigest";
};
export type NovelCommitPayloadRef = string & {
  readonly [payloadRefBrand]: "NovelCommitPayloadRef";
};

const PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PAYLOAD_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\.json$/u;

export function captureNovelCommitPayloadDigest(
  value: unknown,
): NovelCommitPayloadDigest {
  if (typeof value !== "string" || !PAYLOAD_DIGEST.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidCommitPayload,
      "commitPayloadDigest",
    );
  }
  return value as NovelCommitPayloadDigest;
}

export function captureNovelCommitPayloadRef(
  value: unknown,
): NovelCommitPayloadRef {
  if (typeof value !== "string" || !PAYLOAD_REF.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidCommitPayload,
      "commitPayloadRef",
    );
  }
  return value as NovelCommitPayloadRef;
}

export function commitPayloadRef(commitId: NovelCommitId): NovelCommitPayloadRef {
  return captureNovelCommitPayloadRef(`${captureNovelCommitId(commitId)}.json`);
}
