/** Immutable resolution decisions; application remains a separate Operation step. */
import { canonicalStringifyJson, type JsonObject } from "../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelConflictId,
  captureNovelDraftSessionId,
  type NovelConflictId,
  type NovelDraftSessionId,
} from "../identity/index.js";
import { captureNovelOperation, type NovelOperation } from "../operation/index.js";
import { captureNovelTimestamp, type NovelTimestamp } from "../version/index.js";

export const NOVEL_CONFLICT_RESOLUTION_VERSION = 1 as const;

export type NovelConflictResolution =
  | { readonly strategy: "keep-canonical" }
  | { readonly strategy: "keep-draft" }
  | { readonly strategy: "drop-operation" }
  | {
      readonly strategy: "manual";
      readonly replacement: NovelOperation;
    };

export interface NovelConflictResolutionRecord {
  readonly resolutionVersion: typeof NOVEL_CONFLICT_RESOLUTION_VERSION;
  readonly draftSessionId: NovelDraftSessionId;
  readonly conflictId: NovelConflictId;
  readonly resolution: NovelConflictResolution;
  readonly resolvedAt: NovelTimestamp;
}

export function captureNovelConflictResolution(
  value: NovelConflictResolution,
): NovelConflictResolution {
  switch (value.strategy) {
    case "keep-canonical":
    case "keep-draft":
    case "drop-operation":
      if (Object.keys(value).length !== 1) throw invalidResolution();
      return Object.freeze({ strategy: value.strategy });
    case "manual":
      if (Object.keys(value).length !== 2) throw invalidResolution();
      return Object.freeze({
        strategy: "manual",
        replacement: captureNovelOperation(value.replacement),
      });
    default:
      throw invalidResolution();
  }
}

export function captureNovelConflictResolutionRecord(
  value: NovelConflictResolutionRecord,
): NovelConflictResolutionRecord {
  if (value.resolutionVersion !== NOVEL_CONFLICT_RESOLUTION_VERSION) {
    throw invalidResolution();
  }
  return Object.freeze({
    resolutionVersion: NOVEL_CONFLICT_RESOLUTION_VERSION,
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    conflictId: captureNovelConflictId(value.conflictId),
    resolution: captureNovelConflictResolution(value.resolution),
    resolvedAt: captureNovelTimestamp(value.resolvedAt),
  });
}

export function canonicalizeNovelConflictResolutionRecord(
  value: NovelConflictResolutionRecord,
): string {
  const record = captureNovelConflictResolutionRecord(value);
  const envelope: JsonObject = {
    resolutionVersion: record.resolutionVersion,
    draftSessionId: record.draftSessionId,
    conflictId: record.conflictId,
    resolution: record.resolution.strategy === "manual"
      ? {
          strategy: "manual",
          replacement: JSON.parse(
            JSON.stringify(record.resolution.replacement),
          ),
        }
      : { strategy: record.resolution.strategy },
    resolvedAt: record.resolvedAt,
  };
  return canonicalStringifyJson(envelope);
}

function invalidResolution(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidConflictResolution,
    "conflictResolution",
  );
}
