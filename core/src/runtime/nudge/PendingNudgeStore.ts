/** Async state port for one Conversation's recoverable Nudge lifecycle. */
import type {
  NudgeAcknowledgementReference,
  NudgeConditionReference,
  NudgeLease,
  PendingNudge,
} from "./NudgeProtocol.js";
import type { NudgeCooldownRecord } from "./NudgeSelector.js";

export const NUDGE_SCHEDULE_OUTCOME = {
  scheduled: "scheduled",
  deduplicated: "deduplicated",
  unchanged: "unchanged",
} as const;

export type NudgeScheduleOutcome =
  (typeof NUDGE_SCHEDULE_OUTCOME)[keyof typeof NUDGE_SCHEDULE_OUTCOME];

export interface NudgeScheduleResult {
  readonly outcome: NudgeScheduleOutcome;
  readonly nudge: PendingNudge;
}

export interface PendingNudgeLeaseResult {
  readonly lease: NudgeLease;
  readonly nudges: readonly PendingNudge[];
  readonly unchanged: boolean;
}

export interface NudgeDispatchConfirmationRequest {
  readonly providerCallId: string;
  readonly dispatchedAt: string;
}

export interface NudgeConsumptionRecord {
  readonly nudgeId: string;
  readonly policyId: string;
  readonly dedupeKey: string;
  readonly leaseId: string;
  readonly providerCallId: string;
  readonly targetRunId: string;
  readonly targetTurnNumber?: number;
  readonly leasedAt: string;
  readonly consumedAt: string;
}

export interface NudgeDispatchConfirmationResult {
  readonly lease: NudgeLease;
  readonly nudges: readonly PendingNudge[];
  readonly consumptions: readonly NudgeConsumptionRecord[];
  readonly unchanged: boolean;
}

export interface NudgeAcknowledgementRequest {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly acknowledgementRef: NudgeAcknowledgementReference;
  readonly acknowledgedAt: string;
}

export interface NudgeConditionResolutionRequest {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly conditionRef: NudgeConditionReference;
  readonly resolvedAt: string;
}

export interface NudgeSupersessionRequest {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly supersededByNudgeId: string;
  readonly supersededAt: string;
}

export interface NudgeDeliveryAttemptRecord {
  readonly nudgeId: string;
  readonly leaseId: string;
  readonly providerCallId: string;
  readonly attemptNumber: number;
  readonly leasedAt: string;
  readonly status: "leased" | "released" | "confirmed";
  readonly completedAt?: string;
}

/** 每次确认交付的 turn 记录（含 until_acknowledged 重交付；供 cooldown 用）。 */
export interface NudgeDeliveryTurnRecord {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly policyId: string;
  readonly dedupeKey: string;
  readonly targetTurnNumber: number;
  readonly deliveredAt: string;
}

export interface NudgeLeaseReconciliationResult {
  readonly nudgeIds: readonly string[];
  readonly providerCallIds: readonly string[];
}

export interface NudgeLeaseReleaseRequest {
  readonly providerCallId: string;
  readonly releasedAt: string;
}

export const NUDGE_LEASE_RELEASE_OUTCOME = {
  released: "released",
  alreadyReleased: "already_released",
  alreadyConsumed: "already_consumed",
} as const;

export type NudgeLeaseReleaseOutcome =
  (typeof NUDGE_LEASE_RELEASE_OUTCOME)[keyof typeof NUDGE_LEASE_RELEASE_OUTCOME];

export interface NudgeLeaseReleaseResult {
  readonly outcome: NudgeLeaseReleaseOutcome;
  readonly providerCallId: string;
  readonly nudgeIds: readonly string[];
}

export interface NudgeExpiryRequest {
  readonly targetRunId: string;
  readonly evaluatedAt: string;
  readonly currentTurnNumber?: number;
  readonly runEnded?: boolean;
}

export const PENDING_NUDGE_STORE_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export interface PendingNudgeStoreSnapshot {
  readonly schemaVersion: 1 | typeof PENDING_NUDGE_STORE_SNAPSHOT_SCHEMA_VERSION;
  readonly nudges: readonly PendingNudge[];
  readonly leases: readonly NudgeLease[];
  readonly consumptions: readonly NudgeConsumptionRecord[];
  readonly deliveryAttempts?: readonly NudgeDeliveryAttemptRecord[];
  readonly deliveryTurns?: readonly NudgeDeliveryTurnRecord[];
}

export interface PendingNudgeStore {
  schedule(nudge: PendingNudge): Promise<NudgeScheduleResult>;

  list(): Promise<readonly PendingNudge[]>;

  listCooldowns(): Promise<readonly NudgeCooldownRecord[]>;

  getActiveLease(providerCallId: string): Promise<PendingNudgeLeaseResult | undefined>;

  lease(lease: NudgeLease): Promise<PendingNudgeLeaseResult>;

  confirmDispatched(
    request: NudgeDispatchConfirmationRequest,
  ): Promise<NudgeDispatchConfirmationResult>;

  listActive(targetRunId?: string): Promise<readonly PendingNudge[]>;

  acknowledge(request: NudgeAcknowledgementRequest): Promise<PendingNudge>;

  resolveCondition(request: NudgeConditionResolutionRequest): Promise<PendingNudge>;

  supersede(request: NudgeSupersessionRequest): Promise<PendingNudge>;

  reconcileLeases(): Promise<NudgeLeaseReconciliationResult>;

  releaseBeforeDispatch(
    request: NudgeLeaseReleaseRequest,
  ): Promise<NudgeLeaseReleaseResult>;

  expire(request: NudgeExpiryRequest): Promise<readonly PendingNudge[]>;

  snapshot(): Promise<PendingNudgeStoreSnapshot>;

  restore(snapshot: PendingNudgeStoreSnapshot): Promise<void>;
}
