/** Immutable ordered Operation plan produced from durable conflict resolutions. */
import {
  canonicalStringifyJson,
  type JsonObject,
  type JsonValue,
} from "../../event/index.js";
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
import {
  captureNovelOperation,
  captureNovelOperationDigest,
  type NovelOperation,
  type NovelOperationDigest,
} from "../operation/index.js";
import {
  captureNovelRevision,
  captureNovelTimestamp,
  type NovelRevision,
  type NovelTimestamp,
} from "../version/index.js";

declare const novelResolutionApplicationPlanDigestBrand: unique symbol;

export const NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION = 1 as const;

export type NovelResolutionApplicationPlanDigest = string & {
  readonly [novelResolutionApplicationPlanDigestBrand]:
    "NovelResolutionApplicationPlanDigest";
};

export type NovelResolutionApplicationEntry =
  | {
      readonly sourceSequence: number;
      readonly action: "apply-original";
      readonly operation: NovelOperation;
      readonly operationDigest: NovelOperationDigest;
    }
  | {
      readonly sourceSequence: number;
      readonly action: "apply-replacement";
      readonly conflictId: NovelConflictId;
      readonly strategy: "keep-draft" | "manual";
      readonly operation: NovelOperation;
      readonly operationDigest: NovelOperationDigest;
    }
  | {
      readonly sourceSequence: number;
      readonly action: "skip";
      readonly conflictId: NovelConflictId;
      readonly strategy:
        | "keep-canonical"
        | "keep-draft"
        | "drop-operation";
    };

export interface NovelResolutionApplicationPlanContent {
  readonly planVersion: typeof NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION;
  readonly sourceDraftSessionId: NovelDraftSessionId;
  readonly conflictedCandidateDraftSessionId: NovelDraftSessionId;
  readonly baseRevision: NovelRevision;
  readonly sourceOperationCount: number;
  readonly effectiveOperationCount: number;
  readonly entries: readonly NovelResolutionApplicationEntry[];
  readonly createdAt: NovelTimestamp;
}

export interface NovelResolutionApplicationPlan
  extends NovelResolutionApplicationPlanContent {
  readonly digest: NovelResolutionApplicationPlanDigest;
}

export interface NovelResolutionApplicationPlanDigester {
  readonly algorithm: "sha256";
  digest(
    plan: NovelResolutionApplicationPlanContent,
  ): Promise<NovelResolutionApplicationPlanDigest>;
}

const PLAN_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function captureNovelResolutionApplicationPlanDigest(
  value: unknown,
): NovelResolutionApplicationPlanDigest {
  if (typeof value !== "string" || !PLAN_DIGEST.test(value)) {
    throw invalidPlan();
  }
  return value as NovelResolutionApplicationPlanDigest;
}

export function captureNovelResolutionApplicationPlanContent(
  value: NovelResolutionApplicationPlanContent,
): NovelResolutionApplicationPlanContent {
  if (
    value.planVersion !== NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION ||
    value.sourceDraftSessionId === value.conflictedCandidateDraftSessionId ||
    !Array.isArray(value.entries)
  ) {
    throw invalidPlan();
  }
  const entries = Object.freeze(value.entries.map(captureEntry));
  const sourceOperationCount = captureCount(value.sourceOperationCount);
  const effectiveOperationCount = captureCount(value.effectiveOperationCount);
  if (
    entries.length !== sourceOperationCount ||
    effectiveOperationCount !==
      entries.filter((entry) => entry.action !== "skip").length ||
    entries.some((entry, index) => entry.sourceSequence !== index + 1)
  ) {
    throw invalidPlan();
  }
  const operationIds = entries.flatMap((entry) =>
    entry.action === "skip" ? [] : [entry.operation.operationId]
  );
  if (new Set(operationIds).size !== operationIds.length) throw invalidPlan();
  return Object.freeze({
    planVersion: NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION,
    sourceDraftSessionId: captureNovelDraftSessionId(
      value.sourceDraftSessionId,
    ),
    conflictedCandidateDraftSessionId: captureNovelDraftSessionId(
      value.conflictedCandidateDraftSessionId,
    ),
    baseRevision: captureNovelRevision(value.baseRevision),
    sourceOperationCount,
    effectiveOperationCount,
    entries,
    createdAt: captureNovelTimestamp(value.createdAt),
  });
}

export function captureNovelResolutionApplicationPlan(
  value: NovelResolutionApplicationPlan,
): NovelResolutionApplicationPlan {
  return Object.freeze({
    ...captureNovelResolutionApplicationPlanContent(value),
    digest: captureNovelResolutionApplicationPlanDigest(value.digest),
  });
}

export function canonicalizeNovelResolutionApplicationPlanIdentity(
  value: NovelResolutionApplicationPlanContent,
): string {
  const plan = captureNovelResolutionApplicationPlanContent(value);
  return canonicalStringifyJson({
    planVersion: plan.planVersion,
    sourceDraftSessionId: plan.sourceDraftSessionId,
    conflictedCandidateDraftSessionId:
      plan.conflictedCandidateDraftSessionId,
    baseRevision: plan.baseRevision,
    sourceOperationCount: plan.sourceOperationCount,
    effectiveOperationCount: plan.effectiveOperationCount,
    entries: plan.entries.map((entry) => ({
      sourceSequence: entry.sourceSequence,
      action: entry.action,
      ...(entry.action === "apply-original"
        ? { operationDigest: entry.operationDigest }
        : {
            conflictId: entry.conflictId,
            strategy: entry.strategy,
            ...(entry.action === "apply-replacement"
              ? { operationDigest: entry.operationDigest }
              : {}),
          }),
    })) as JsonValue[],
  });
}

export function canonicalizeNovelResolutionApplicationPlan(
  value: NovelResolutionApplicationPlan,
): string {
  const plan = captureNovelResolutionApplicationPlan(value);
  const envelope: JsonObject = {
    planVersion: plan.planVersion,
    sourceDraftSessionId: plan.sourceDraftSessionId,
    conflictedCandidateDraftSessionId:
      plan.conflictedCandidateDraftSessionId,
    baseRevision: plan.baseRevision,
    sourceOperationCount: plan.sourceOperationCount,
    effectiveOperationCount: plan.effectiveOperationCount,
    entries: plan.entries.map(canonicalEntry) as JsonValue[],
    digest: plan.digest,
    createdAt: plan.createdAt,
  };
  return canonicalStringifyJson(envelope);
}

export function canonicalizeNovelResolutionApplicationEntry(
  value: NovelResolutionApplicationEntry,
): string {
  return canonicalStringifyJson(canonicalEntry(captureEntry(value)));
}

function captureEntry(
  value: NovelResolutionApplicationEntry,
): NovelResolutionApplicationEntry {
  const sourceSequence = captureSequence(value.sourceSequence);
  switch (value.action) {
    case "apply-original":
      if (Object.keys(value).length !== 4) throw invalidPlan();
      return Object.freeze({
        sourceSequence,
        action: "apply-original",
        operation: captureNovelOperation(value.operation),
        operationDigest: captureNovelOperationDigest(value.operationDigest),
      });
    case "apply-replacement":
      if (
        Object.keys(value).length !== 6 ||
        (value.strategy !== "keep-draft" && value.strategy !== "manual")
      ) {
        throw invalidPlan();
      }
      return Object.freeze({
        sourceSequence,
        action: "apply-replacement",
        conflictId: captureNovelConflictId(value.conflictId),
        strategy: value.strategy,
        operation: captureNovelOperation(value.operation),
        operationDigest: captureNovelOperationDigest(value.operationDigest),
      });
    case "skip":
      if (
        Object.keys(value).length !== 4 ||
        (value.strategy !== "keep-canonical" &&
          value.strategy !== "keep-draft" &&
          value.strategy !== "drop-operation")
      ) {
        throw invalidPlan();
      }
      return Object.freeze({
        sourceSequence,
        action: "skip",
        conflictId: captureNovelConflictId(value.conflictId),
        strategy: value.strategy,
      });
    default:
      throw invalidPlan();
  }
}

function canonicalEntry(value: NovelResolutionApplicationEntry): JsonObject {
  return value.action === "skip"
    ? {
        sourceSequence: value.sourceSequence,
        action: value.action,
        conflictId: value.conflictId,
        strategy: value.strategy,
      }
    : {
        sourceSequence: value.sourceSequence,
        action: value.action,
        ...(value.action === "apply-replacement"
          ? { conflictId: value.conflictId, strategy: value.strategy }
          : {}),
        operation: JSON.parse(JSON.stringify(value.operation)),
        operationDigest: value.operationDigest,
      };
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidPlan();
  }
  return value as number;
}

function captureSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidPlan();
  }
  return value as number;
}

function invalidPlan(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidResolutionApplicationPlan,
    "resolutionApplicationPlan",
  );
}
