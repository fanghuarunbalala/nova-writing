/** Provider-neutral versioned Nudge contracts shared by Runtime components. */
import type { JsonValue } from "../../event/index.js";

export const NUDGE_PLACEMENT = {
  systemPromptOverlay: "system-prompt-overlay",
} as const;

export type NudgePlacement =
  (typeof NUDGE_PLACEMENT)[keyof typeof NUDGE_PLACEMENT];

export const NUDGE_DELIVERY = {
  once: "once",
  untilAcknowledged: "until_acknowledged",
  untilCondition: "until_condition",
} as const;

export type NudgeDelivery =
  (typeof NUDGE_DELIVERY)[keyof typeof NUDGE_DELIVERY];

export interface NudgeAcknowledgementReference {
  readonly id: string;
  readonly version: string;
}

export interface NudgeConditionReference {
  readonly id: string;
  readonly version: string;
}

export const PENDING_NUDGE_STATE = {
  scheduled: "scheduled",
  leased: "leased",
  applied: "applied",
  active: "active",
  consumed: "consumed",
  acknowledged: "acknowledged",
  resolved: "resolved",
  expired: "expired",
  superseded: "superseded",
} as const;

export type PendingNudgeState =
  (typeof PENDING_NUDGE_STATE)[keyof typeof PENDING_NUDGE_STATE];

export const NUDGE_SELECTION_LIMIT = {
  default: 1,
  maximum: 2,
} as const;

export interface NudgeEffect {
  readonly kind: "nudge";
  readonly policyId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  /** 系统提醒的语义类别（如 "compose_mode"/"compose_mode_exit"；默认 "nudge"）。 */
  readonly reminderKind?: string;
  readonly delivery?: NudgeDelivery;
  readonly acknowledgementRef?: NudgeAcknowledgementReference;
  readonly conditionRef?: NudgeConditionReference;
  readonly priority: number;
  readonly dedupeKey: string;
  readonly targetRunId: string;
  readonly targetTurnNumber?: number;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly cooldownTurns?: number;
  readonly expiresAfterTurn?: number;
  readonly expiresAt?: string;
  readonly exclusive?: boolean;
}

export interface PendingNudge {
  readonly id: string;
  readonly policyId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly priority: number;
  readonly dedupeKey: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly exclusive: boolean;
  readonly placement: NudgePlacement;
  readonly delivery: NudgeDelivery;
  /** 系统提醒的语义类别（如 "compose_mode"/"compose_mode_exit"；默认 "nudge"）。 */
  readonly reminderKind?: string;
  /** 已确认交付次数（0 = 尚未交付；render 时本次交付计数 = deliveryCount + 1）。 */
  readonly deliveryCount: number;
  readonly acknowledgementRef?: NudgeAcknowledgementReference;
  readonly conditionRef?: NudgeConditionReference;
  readonly state: PendingNudgeState;
  readonly targetRunId: string;
  readonly targetTurnNumber?: number;
  readonly scheduledSequence: number;
  readonly scheduledAt: string;
  readonly cooldownTurns?: number;
  readonly expiresAfterTurn?: number;
  readonly expiresAt?: string;
}

export interface NudgeLeaseRequest {
  readonly providerCallId: string;
  readonly targetRunId: string;
  readonly targetTurnNumber?: number;
  readonly requestedLimit?: number;
  readonly requestedAt: string;
}

export interface NudgeLease {
  readonly leaseId: string;
  readonly providerCallId: string;
  readonly targetRunId: string;
  readonly targetTurnNumber?: number;
  readonly nudgeIds: readonly string[];
  readonly leasedAt: string;
}

export interface SystemReminderOverlay {
  readonly placement: "system-prompt-overlay";
  readonly nudgeIds: readonly string[];
  readonly content: string;
  /** 本次 overlay 对应提醒的语义类别（单 nudge；默认 "nudge"）。 */
  readonly reminderKind?: string;
}
