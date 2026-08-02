/** Immutable structured Context memory derived from a canonical Message range. */
import type { ArtifactReference } from "../../storage/artifact/index.js";

export const CONTEXT_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const CONTEXT_CHECKPOINT_ITEM_PRIORITY = {
  critical: "critical",
  high: "high",
  normal: "normal",
  low: "low",
} as const;

export type ContextCheckpointItemPriority =
  (typeof CONTEXT_CHECKPOINT_ITEM_PRIORITY)[keyof typeof CONTEXT_CHECKPOINT_ITEM_PRIORITY];

export interface ContextCheckpointItem {
  readonly id: string;
  readonly text: string;
  readonly priority: ContextCheckpointItemPriority;
  readonly sourceMessageIds: readonly string[];
  readonly artifactReferences: readonly ArtifactReference[];
}

export interface ContextCheckpoint {
  readonly schemaVersion: typeof CONTEXT_CHECKPOINT_SCHEMA_VERSION;
  readonly id: string;
  readonly conversationId: string;
  readonly parentCheckpointId?: string;
  readonly sourceStartSequence: number;
  readonly sourceEndSequence: number;
  readonly coveredThroughSequence: number;
  readonly sourceDigest: string;
  readonly summary: string;
  readonly facts: readonly ContextCheckpointItem[];
  readonly decisions: readonly ContextCheckpointItem[];
  readonly constraints: readonly ContextCheckpointItem[];
  readonly unresolvedTasks: readonly ContextCheckpointItem[];
  readonly pinnedMessageIds: readonly string[];
  readonly recentWindowStartSequence: number;
  readonly tokenEstimateBefore: number;
  readonly tokenEstimateAfter: number;
  readonly compactorId: string;
  readonly compactorVersion: string;
  readonly createdAt: string;
  readonly contentDigest: string;
}
