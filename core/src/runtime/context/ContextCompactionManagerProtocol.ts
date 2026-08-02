/** Provider-neutral Compaction orchestration, source, and attempt contracts. */
import type { RuntimeMessageSnapshot } from "../message/index.js";
import type { ContextCompactionEffect } from "../policy/RuntimePolicyProtocol.js";
import type { ContextCheckpoint, ContextCheckpointItem } from "./ContextCheckpoint.js";
import type { ContextCompactionAssessment, ContextCompactionAttemptIdentity } from "./ContextCompactionProtocol.js";
import type { ContextPinnedMessageGroup } from "./ContextPinnedMessageGroup.js";

export interface ContextCompactionSourceMessage {
  readonly sequence: number;
  readonly ordinal: number;
  readonly message: RuntimeMessageSnapshot;
}

export interface ContextCompactionSource {
  readonly conversationId: string;
  readonly sourceStartSequence: number;
  readonly sourceEndSequence: number;
  readonly messages: readonly ContextCompactionSourceMessage[];
  readonly pinnedGroups: readonly ContextPinnedMessageGroup[];
}

export interface ContextCompactionSourceRequest {
  readonly effect: ContextCompactionEffect;
  readonly activeCheckpoint?: ContextCheckpoint;
}

export interface ContextCompactionSourceProvider {
  load(request: ContextCompactionSourceRequest): Promise<ContextCompactionSource>;
}

export interface ContextCompactorRequest {
  readonly effect: ContextCompactionEffect;
  readonly source: ContextCompactionSource;
  readonly sourceDigest: string;
  readonly activeCheckpoint?: ContextCheckpoint;
}

export interface ContextCompactorResult {
  readonly summary: string;
  readonly facts: readonly ContextCheckpointItem[];
  readonly decisions: readonly ContextCheckpointItem[];
  readonly constraints: readonly ContextCheckpointItem[];
  readonly unresolvedTasks: readonly ContextCheckpointItem[];
  readonly pinnedMessageIds: readonly string[];
  readonly recentWindowStartSequence: number;
  readonly tokenEstimateAfter: number;
}

export interface ContextCompactor {
  readonly id: string;
  readonly version: string;

  compact(request: ContextCompactorRequest): Promise<ContextCompactorResult>;
}

export interface ContextCompactionHasher {
  readonly algorithm: "sha256";

  digest(canonicalContent: string): Promise<string>;
}

export interface ContextCheckpointIdFactory {
  create(input: {
    readonly conversationId: string;
    readonly sourceDigest: string;
    readonly compactorId: string;
    readonly compactorVersion: string;
  }): string;
}

export interface ContextCompactionClock {
  now(): string;
}

export interface ContextCheckpointSemanticValidationRequest {
  readonly effect: ContextCompactionEffect;
  readonly source: ContextCompactionSource;
  readonly checkpoint: ContextCheckpoint;
  readonly activeCheckpoint?: ContextCheckpoint;
}

export interface ContextCheckpointSemanticValidator {
  validate(request: ContextCheckpointSemanticValidationRequest): Promise<void>;
}

export const CONTEXT_COMPACTION_ATTEMPT_STATUS = {
  reserved: "reserved",
  completed: "completed",
  failed: "failed",
} as const;

export type ContextCompactionAttemptStatus =
  (typeof CONTEXT_COMPACTION_ATTEMPT_STATUS)[keyof typeof CONTEXT_COMPACTION_ATTEMPT_STATUS];

export const CONTEXT_COMPACTION_ATTEMPT_FAILURE = {
  compactorFailed: "compactor_failed",
  resultInvalid: "result_invalid",
  checkpointDigestFailed: "checkpoint_digest_failed",
  checkpointInvalid: "checkpoint_invalid",
  semanticValidationFailed: "semantic_validation_failed",
} as const;

export type ContextCompactionAttemptFailure =
  (typeof CONTEXT_COMPACTION_ATTEMPT_FAILURE)[keyof typeof CONTEXT_COMPACTION_ATTEMPT_FAILURE];

export interface ContextCompactionAttemptRecord {
  readonly identity: ContextCompactionAttemptIdentity;
  readonly runId: string;
  readonly providerCallId: string;
  readonly requestedAt: string;
  readonly expectedParentCheckpointId?: string;
  readonly status: ContextCompactionAttemptStatus;
  readonly completedAt?: string;
  readonly assessment?: ContextCompactionAssessment;
  readonly failure?: ContextCompactionAttemptFailure;
}

export const CONTEXT_COMPACTION_RESERVATION_OUTCOME = {
  reserved: "reserved",
  duplicate: "duplicate",
} as const;

export type ContextCompactionReservationOutcome =
  (typeof CONTEXT_COMPACTION_RESERVATION_OUTCOME)[keyof typeof CONTEXT_COMPACTION_RESERVATION_OUTCOME];

export interface ContextCompactionReservationResult {
  readonly outcome: ContextCompactionReservationOutcome;
  readonly attempt: ContextCompactionAttemptRecord;
}

export const CONTEXT_COMPACTION_MANAGER_DISPOSITION = {
  activated: "activated",
  unreducible: "unreducible",
  duplicate: "duplicate",
} as const;

export type ContextCompactionManagerDisposition =
  (typeof CONTEXT_COMPACTION_MANAGER_DISPOSITION)[keyof typeof CONTEXT_COMPACTION_MANAGER_DISPOSITION];

export interface ContextCompactionManagerResult {
  readonly disposition: ContextCompactionManagerDisposition;
  readonly attempt: ContextCompactionAttemptRecord;
  readonly assessment?: ContextCompactionAssessment;
  readonly checkpoint?: ContextCheckpoint;
}
