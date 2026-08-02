/** Provider-neutral identities and lifecycle values for one child Conversation. */
import type { ArtifactReference } from "../../storage/artifact/index.js";

export const SUBAGENT_SCHEMA_VERSION = 1 as const;

export const SUBAGENT_LIMITS = Object.freeze({
  maximumDepth: 1,
  maximumActivePerParentRun: 4,
  maximumActiveGlobal: 16,
} as const);

export const SUBAGENT_STATUS = Object.freeze({
  creating: "creating",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  orphaned: "orphaned",
} as const);

export type SubagentStatus =
  (typeof SUBAGENT_STATUS)[keyof typeof SUBAGENT_STATUS];

export type SubagentTerminalStatus = Extract<
  SubagentStatus,
  "completed" | "failed" | "cancelled" | "orphaned"
>;

export const SUBAGENT_CANCELLATION_REASON = Object.freeze({
  parentCompleted: "parent_completed",
  parentFailed: "parent_failed",
  parentStopped: "parent_stopped",
  parentCrashed: "parent_crashed",
  explicit: "explicit",
  limitReclaimed: "limit_reclaimed",
  orphanReclaimed: "orphan_reclaimed",
} as const);

export type SubagentCancellationReason =
  (typeof SUBAGENT_CANCELLATION_REASON)[keyof typeof SUBAGENT_CANCELLATION_REASON];

export interface SubagentRequest {
  readonly schemaVersion: typeof SUBAGENT_SCHEMA_VERSION;
  readonly subagentId: string;
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly parentTurnId?: string;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly objective: string;
  readonly toolPolicyId: string;
  readonly requestedAt: string;
}

export interface SubagentBinding {
  readonly schemaVersion: typeof SUBAGENT_SCHEMA_VERSION;
  readonly subagentId: string;
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly parentTurnId?: string;
  readonly childConversationId: string;
  readonly depth: 1;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly toolPolicyId: string;
  readonly status: SubagentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubagentResult {
  readonly schemaVersion: typeof SUBAGENT_SCHEMA_VERSION;
  readonly subagentId: string;
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly childConversationId: string;
  readonly status: SubagentTerminalStatus;
  readonly summary?: string;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly errorCode?: string;
  readonly cancellationReason?: SubagentCancellationReason;
  readonly completedAt: string;
}
