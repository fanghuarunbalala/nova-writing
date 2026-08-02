/** Versioned, content-safe Novel lifecycle facts persisted before public delivery. */
import { canonicalStringifyJson, type JsonObject } from "../../event/index.js";
import { captureNovelConversationId, captureNovelDraftSessionStatus, type NovelDraftSessionStatus } from "../draft/index.js";
import { NOVEL_PROTOCOL_FAILURE, NovelProtocolValidationError } from "../error/index.js";
import {
  captureNovelCommitId,
  captureNovelConflictId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelOperationId,
  type NovelCommitId,
  type NovelConflictId,
  type NovelDraftSessionId,
  type NovelId,
  type NovelOperationId,
} from "../identity/index.js";
import { captureNovelRevision, captureNovelTimestamp, type NovelRevision, type NovelTimestamp } from "../version/index.js";
import type { NovelConflictKind } from "../conflict/index.js";
import type { NovelConflictResolution } from "../conflict/index.js";

export const NOVEL_LIFECYCLE_RECORD_VERSION = 1 as const;

export const NOVEL_LIFECYCLE_EVENT_TYPE = {
  draftStarted: "draft.started",
  draftStatusChanged: "draft.status-changed",
  draftRolledBack: "draft.rolled-back",
  commitCompleted: "commit.completed",
  commitRecovered: "commit.recovered",
  rebasePrepared: "rebase.prepared",
  rebaseConflicted: "rebase.conflicted",
  rebaseResolved: "rebase.resolved",
  rebasePromoted: "rebase.promoted",
  conflictDetected: "conflict.detected",
  conflictResolved: "conflict.resolved",
  recoveryCompleted: "recovery.completed",
} as const;

export type NovelLifecycleEventType =
  (typeof NOVEL_LIFECYCLE_EVENT_TYPE)[keyof typeof NOVEL_LIFECYCLE_EVENT_TYPE];

export interface NovelLifecyclePayloads {
  readonly "draft.started": { readonly draftSessionId: NovelDraftSessionId; readonly baseRevision: NovelRevision };
  readonly "draft.status-changed": { readonly draftSessionId: NovelDraftSessionId; readonly previousStatus: NovelDraftSessionStatus; readonly currentStatus: NovelDraftSessionStatus };
  readonly "draft.rolled-back": { readonly draftSessionId: NovelDraftSessionId; readonly baseRevision: NovelRevision };
  readonly "commit.completed": { readonly draftSessionId: NovelDraftSessionId; readonly commitId: NovelCommitId; readonly baseRevision: NovelRevision; readonly resultRevision: NovelRevision; readonly operationCount: number };
  readonly "commit.recovered": { readonly draftSessionId: NovelDraftSessionId; readonly commitId: NovelCommitId; readonly resultRevision: NovelRevision; readonly recovery: "payload-regenerated" | "metadata-confirmed" };
  readonly "rebase.prepared": { readonly sourceDraftSessionId: NovelDraftSessionId; readonly candidateDraftSessionId: NovelDraftSessionId; readonly sourceBaseRevision: NovelRevision; readonly candidateBaseRevision: NovelRevision; readonly operationCount: number };
  readonly "rebase.conflicted": { readonly sourceDraftSessionId: NovelDraftSessionId; readonly candidateDraftSessionId: NovelDraftSessionId; readonly candidateBaseRevision: NovelRevision; readonly conflictCount: number };
  readonly "rebase.resolved": { readonly sourceDraftSessionId: NovelDraftSessionId; readonly conflictedCandidateDraftSessionId: NovelDraftSessionId; readonly resolvedCandidateDraftSessionId: NovelDraftSessionId; readonly candidateBaseRevision: NovelRevision; readonly effectiveOperationCount: number };
  readonly "rebase.promoted": { readonly sourceDraftSessionId: NovelDraftSessionId; readonly resolvedCandidateDraftSessionId: NovelDraftSessionId; readonly baseRevision: NovelRevision };
  readonly "conflict.detected": { readonly draftSessionId: NovelDraftSessionId; readonly conflictId: NovelConflictId; readonly operationId: NovelOperationId; readonly kind: NovelConflictKind };
  readonly "conflict.resolved": { readonly draftSessionId: NovelDraftSessionId; readonly conflictId: NovelConflictId; readonly strategy: NovelConflictResolution["strategy"] };
  readonly "recovery.completed": { readonly scope: "draft" | "commit" | "rebase" | "projection"; readonly outcome: "recovered" | "cleaned" | "verified" | "rebuilt"; readonly affectedCount: number };
}

export type NovelLifecycleRecord<T extends NovelLifecycleEventType = NovelLifecycleEventType> = {
  readonly recordVersion: typeof NOVEL_LIFECYCLE_RECORD_VERSION;
  readonly eventId: string;
  readonly eventType: T;
  readonly novelId: NovelId;
  readonly conversationId: string;
  readonly occurredAt: NovelTimestamp;
  readonly payload: NovelLifecyclePayloads[T];
};

const EVENT_TYPES = new Set<unknown>(Object.values(NOVEL_LIFECYCLE_EVENT_TYPE));
const SAFE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const CONFLICT_KINDS = new Set<unknown>(["field-modified", "entity-deleted", "entity-created", "parent-changed", "order-changed", "manuscript-block-modified", "domain-invariant"]);
const RESOLUTION_STRATEGIES = new Set<unknown>(["keep-canonical", "keep-draft", "drop-operation", "manual"]);
const RECOVERY_SCOPES = new Set<unknown>(["draft", "commit", "rebase", "projection"]);
const RECOVERY_OUTCOMES = new Set<unknown>(["recovered", "cleaned", "verified", "rebuilt"]);

export function captureNovelLifecycleRecord<T extends NovelLifecycleEventType>(
  value: NovelLifecycleRecord<T>,
): NovelLifecycleRecord<T> {
  if (value.recordVersion !== NOVEL_LIFECYCLE_RECORD_VERSION || !EVENT_TYPES.has(value.eventType)) throw invalid();
  const base = {
    recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
    eventId: captureEventId(value.eventId),
    eventType: value.eventType,
    novelId: captureNovelId(value.novelId),
    conversationId: captureNovelConversationId(value.conversationId),
    occurredAt: captureNovelTimestamp(value.occurredAt),
  };
  return Object.freeze({ ...base, payload: capturePayload(value.eventType, value.payload) }) as NovelLifecycleRecord<T>;
}

export function canonicalizeNovelLifecycleRecord(record: NovelLifecycleRecord): string {
  const captured = captureNovelLifecycleRecord(record);
  return canonicalStringifyJson(captured as unknown as JsonObject);
}

function capturePayload<T extends NovelLifecycleEventType>(type: T, input: NovelLifecyclePayloads[T]): NovelLifecyclePayloads[T] {
  const value = input as Record<string, unknown>;
  let payload: Record<string, unknown>;
  switch (type) {
    case "draft.started": case "draft.rolled-back":
      payload = { draftSessionId: captureNovelDraftSessionId(value.draftSessionId), baseRevision: captureNovelRevision(value.baseRevision) }; break;
    case "draft.status-changed":
      payload = { draftSessionId: captureNovelDraftSessionId(value.draftSessionId), previousStatus: captureNovelDraftSessionStatus(value.previousStatus), currentStatus: captureNovelDraftSessionStatus(value.currentStatus) }; break;
    case "commit.completed":
      payload = { draftSessionId: captureNovelDraftSessionId(value.draftSessionId), commitId: captureNovelCommitId(value.commitId), baseRevision: captureNovelRevision(value.baseRevision), resultRevision: captureNovelRevision(value.resultRevision), operationCount: captureCount(value.operationCount) }; break;
    case "commit.recovered":
      if (value.recovery !== "payload-regenerated" && value.recovery !== "metadata-confirmed") throw invalid();
      payload = { draftSessionId: captureNovelDraftSessionId(value.draftSessionId), commitId: captureNovelCommitId(value.commitId), resultRevision: captureNovelRevision(value.resultRevision), recovery: value.recovery }; break;
    case "rebase.prepared":
      payload = { sourceDraftSessionId: captureNovelDraftSessionId(value.sourceDraftSessionId), candidateDraftSessionId: captureNovelDraftSessionId(value.candidateDraftSessionId), sourceBaseRevision: captureNovelRevision(value.sourceBaseRevision), candidateBaseRevision: captureNovelRevision(value.candidateBaseRevision), operationCount: captureCount(value.operationCount) }; break;
    case "rebase.conflicted":
      payload = { sourceDraftSessionId: captureNovelDraftSessionId(value.sourceDraftSessionId), candidateDraftSessionId: captureNovelDraftSessionId(value.candidateDraftSessionId), candidateBaseRevision: captureNovelRevision(value.candidateBaseRevision), conflictCount: captureCount(value.conflictCount) }; break;
    case "rebase.resolved":
      payload = { sourceDraftSessionId: captureNovelDraftSessionId(value.sourceDraftSessionId), conflictedCandidateDraftSessionId: captureNovelDraftSessionId(value.conflictedCandidateDraftSessionId), resolvedCandidateDraftSessionId: captureNovelDraftSessionId(value.resolvedCandidateDraftSessionId), candidateBaseRevision: captureNovelRevision(value.candidateBaseRevision), effectiveOperationCount: captureCount(value.effectiveOperationCount) }; break;
    case "rebase.promoted":
      payload = { sourceDraftSessionId: captureNovelDraftSessionId(value.sourceDraftSessionId), resolvedCandidateDraftSessionId: captureNovelDraftSessionId(value.resolvedCandidateDraftSessionId), baseRevision: captureNovelRevision(value.baseRevision) }; break;
    case "conflict.detected":
      if (!CONFLICT_KINDS.has(value.kind)) throw invalid();
      payload = { draftSessionId: captureNovelDraftSessionId(value.draftSessionId), conflictId: captureNovelConflictId(value.conflictId), operationId: captureNovelOperationId(value.operationId), kind: value.kind }; break;
    case "conflict.resolved":
      if (!RESOLUTION_STRATEGIES.has(value.strategy)) throw invalid();
      payload = { draftSessionId: captureNovelDraftSessionId(value.draftSessionId), conflictId: captureNovelConflictId(value.conflictId), strategy: value.strategy }; break;
    case "recovery.completed":
      if (!RECOVERY_SCOPES.has(value.scope) || !RECOVERY_OUTCOMES.has(value.outcome)) throw invalid();
      payload = { scope: value.scope, outcome: value.outcome, affectedCount: captureCount(value.affectedCount) }; break;
  }
  if (Object.keys(payload).length !== Object.keys(value).length) throw invalid();
  return Object.freeze(payload) as NovelLifecyclePayloads[T];
}

function captureEventId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_EVENT_ID.test(value)) throw invalid();
  return value;
}
function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
}
function invalid(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(NOVEL_PROTOCOL_FAILURE.invalidLifecycleRecord, "lifecycleRecord");
}
