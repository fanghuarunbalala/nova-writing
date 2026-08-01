import type { MessageProjectionIdentity } from "./MessageProjectionIdentity.js";

export type MessageProjectionHealth =
  | "missing"
  | "ready"
  | "behind"
  | "repairable_tail"
  | "corrupted"
  | "projector_mismatch"
  | "schema_unavailable"
  | "journal_regressed";

export type MessageProjectionRecommendedAction =
  | "none"
  | "initialize"
  | "catch_up"
  | "truncate_and_catch_up"
  | "rebuild"
  | "restore_schema";

export type MessageProjectionRebuildReason =
  | "forced"
  | "corrupted"
  | "projector_changed"
  | "journal_regressed";

export interface MessageProjectionInspection {
  conversationId: string;
  health: MessageProjectionHealth;
  recommendedAction: MessageProjectionRecommendedAction;
  journalHighWatermark: number;
  projectedThroughSequence: number;
  expectedProjectorId: string;
  expectedProjectorVersion: string;
  actualProjectorId?: string;
  actualProjectorVersion?: string;
  rebuildReason?: Exclude<MessageProjectionRebuildReason, "forced">;
}

export type MessageProjectionMaintenanceOperation =
  | "initialized"
  | "tail_truncated"
  | "caught_up"
  | "rebuilt";

export interface MessageProjectionMaintenanceResult extends MessageProjectionIdentity {
  conversationId: string;
  operations: readonly MessageProjectionMaintenanceOperation[];
  previousSequence: number;
  projectedThroughSequence: number;
  journalHighWatermark: number;
  processedEventCount: number;
  appendedMessageCount: number;
  rebuildReason?: MessageProjectionRebuildReason;
}
