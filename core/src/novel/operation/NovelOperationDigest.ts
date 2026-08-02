/** Canonical SHA-256 digest protocol for durable Novel Operations. */
import {
  canonicalStringifyJson,
  type JsonObject,
  type JsonValue,
} from "../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import { captureNovelOperation, type NovelOperation } from "./NovelOperation.js";

declare const novelOperationDigestBrand: unique symbol;

export type NovelOperationDigest = string & {
  readonly [novelOperationDigestBrand]: "NovelOperationDigest";
};

const NOVEL_OPERATION_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export interface NovelOperationDigester {
  readonly algorithm: "sha256";
  digest(operation: NovelOperation): Promise<NovelOperationDigest>;
}

export function captureNovelOperationDigest(
  value: unknown,
): NovelOperationDigest {
  if (typeof value !== "string" || !NOVEL_OPERATION_DIGEST.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperationDigest,
      "operationDigest",
    );
  }
  return value as NovelOperationDigest;
}

export function canonicalizeNovelOperation(operation: NovelOperation): string {
  const captured = captureNovelOperation(operation);
  const envelope: JsonObject = {
    operationId: captured.operationId,
    operationVersion: captured.operationVersion,
    type: captured.type,
    expected: captured.expected.map((value) => ({ ...value })) as JsonValue[],
    payload: captured.payload,
  };
  return canonicalStringifyJson(envelope);
}
