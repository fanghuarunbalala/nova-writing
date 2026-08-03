/** Provider-neutral values used by the non-blocking Task, TaskGet, and TaskCancel Tools. */
import type { ArtifactReference } from "../../storage/artifact/index.js";

export const SUBAGENT_TASK_SCHEMA_VERSION = 1 as const;

export const SUBAGENT_TASK_STATUS = Object.freeze({
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  orphaned: "orphaned",
} as const);

export type SubagentTaskStatus =
  (typeof SUBAGENT_TASK_STATUS)[keyof typeof SUBAGENT_TASK_STATUS];

export const SUBAGENT_RUNTIME_PRESENCE = Object.freeze({
  active: "active",
  dormant: "dormant",
  absent: "absent",
} as const);

export type SubagentRuntimePresence =
  (typeof SUBAGENT_RUNTIME_PRESENCE)[keyof typeof SUBAGENT_RUNTIME_PRESENCE];

export const SUBAGENT_TASK_CANCELLATION_STATUS = Object.freeze({
  cancellationRequested: "cancellation_requested",
  alreadyTerminal: "already_terminal",
  notFound: "not_found",
} as const);

export type SubagentTaskCancellationStatus =
  (typeof SUBAGENT_TASK_CANCELLATION_STATUS)[keyof typeof SUBAGENT_TASK_CANCELLATION_STATUS];

export interface SubagentTaskLimits {
  readonly maximumPromptBytes: number;
  readonly maximumArtifactReferences: number;
  readonly maximumResultBytes: number;
}

export interface SubagentDefinition {
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly label: string;
  readonly description: string;
  readonly toolPolicyId: string;
}

export interface SubagentTaskArguments {
  readonly agentType: string;
  readonly prompt: string;
  readonly artifactIds?: readonly string[];
}

export interface SubagentTaskAcceptance {
  readonly schemaVersion: typeof SUBAGENT_TASK_SCHEMA_VERSION;
  readonly taskId: string;
  readonly childConversationId: string;
  readonly status: "queued" | "running";
  readonly acceptedAt: string;
}

export interface SubagentTaskGetArguments {
  readonly taskId: string;
}

export interface SubagentTaskResult {
  readonly content: string;
  readonly artifactReferences: readonly ArtifactReference[];
}

export interface SubagentTaskSnapshot {
  readonly schemaVersion: typeof SUBAGENT_TASK_SCHEMA_VERSION;
  readonly taskId: string;
  readonly childConversationId: string;
  readonly status: SubagentTaskStatus;
  readonly runtimePresence: SubagentRuntimePresence;
  readonly result?: SubagentTaskResult;
  readonly errorCode?: string;
}

export interface SubagentTaskCancelArguments {
  readonly taskId: string;
}

export interface SubagentTaskCancellation {
  readonly schemaVersion: typeof SUBAGENT_TASK_SCHEMA_VERSION;
  readonly taskId: string;
  readonly status: SubagentTaskCancellationStatus;
}

export interface SubagentToolCompositionPolicy {
  readonly allowedAgentTypes: readonly string[];
  readonly limits: SubagentTaskLimits;
}
