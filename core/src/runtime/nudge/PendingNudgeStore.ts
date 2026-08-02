/** Async state port for one Conversation's recoverable Nudge lifecycle. */
import type { NudgeLease, PendingNudge } from "./NudgeProtocol.js";
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

export interface PendingNudgeStoreSnapshot {
  readonly schemaVersion: 1;
  readonly nudges: readonly PendingNudge[];
  readonly leases: readonly NudgeLease[];
  readonly consumptions: readonly NudgeConsumptionRecord[];
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

  releaseBeforeDispatch(
    request: NudgeLeaseReleaseRequest,
  ): Promise<NudgeLeaseReleaseResult>;

  expire(request: NudgeExpiryRequest): Promise<readonly PendingNudge[]>;

  snapshot(): Promise<PendingNudgeStoreSnapshot>;

  restore(snapshot: PendingNudgeStoreSnapshot): Promise<void>;
}
