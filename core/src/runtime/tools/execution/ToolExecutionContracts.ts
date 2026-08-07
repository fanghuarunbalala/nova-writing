/** Provider-neutral immutable contracts crossing the Tool execution boundary. */
import type { JsonValue } from "../../../event/protocol/index.js";

export type ToolArgumentDigest = `sha256:${string}`;

export interface ToolArgumentDigester {
  digest(arguments_: JsonValue): Promise<ToolArgumentDigest>;
}

export interface ToolInvocation {
  readonly conversationId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly turnId?: string;
  readonly toolName: string;
  readonly toolVersion?: string;
  readonly arguments: unknown;
}

export interface CapturedToolInvocation
  extends Omit<ToolInvocation, "arguments"> {
  readonly arguments: JsonValue;
  readonly argumentDigest: ToolArgumentDigest;
}

export type ToolIsolationRequirement = "trusted_process" | "os_process";

export interface ToolRetryPolicy {
  readonly maximumAttempts: 1 | 2;
}

export interface ToolExecutionPolicy {
  readonly timeoutMs: number;
  readonly isolation: ToolIsolationRequirement;
  readonly cancellable: true;
  readonly idempotent: boolean;
  readonly restartable: boolean;
  readonly checkpointable: boolean;
  readonly retry: ToolRetryPolicy;
}

export type ToolPermissionEffect = "allow" | "ask" | "deny";

export interface ToolPermissionDecision {
  readonly effect: ToolPermissionEffect;
  readonly ruleIds: readonly string[];
  readonly hardRestriction: boolean;
}

export interface ToolApprovalIdentity {
  readonly conversationId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: ToolArgumentDigest;
}

export type ToolSideEffectStatus =
  | "none"
  | "possible"
  | "partial"
  | "completed_unknown";

export type ToolErrorCategory =
  | "validation"
  | "permission"
  | "approval_rejected"
  | "sandbox"
  | "timeout"
  | "cancelled"
  | "execution"
  | "internal";

export type ToolTraceStage =
  | "received"
  | "resolved"
  | "validated"
  | "permission_evaluated"
  | "approval_requested"
  | "approval_resolved"
  | "sandbox_started"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "cancelled"
  | "timed_out";

export interface ToolTraceRecord {
  readonly traceId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly turnId?: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: ToolArgumentDigest;
  readonly stage: ToolTraceStage;
  readonly timestamp: string;
  readonly attempt: number;
  readonly durationMs?: number;
  readonly inputBytes?: number;
  readonly outputBytes?: number;
  readonly ruleIds?: readonly string[];
  readonly permissionEffect?: ToolPermissionEffect;
  readonly approvalDecision?: "approved" | "rejected" | "cancelled" | "expired";
  readonly approvalActorId?: string;
  readonly artifactIds?: readonly string[];
  readonly errorCategory?: ToolErrorCategory;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly sideEffectStatus?: ToolSideEffectStatus;
}

/** 工具请求记录（完整参数，落盘供上下文/重建）。Tool request record. */
export interface ToolRequestRecord {
  readonly conversationId: string;
  readonly runId: string;
  readonly turnId?: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly arguments: JsonValue;
  readonly truncated: boolean;
}

/** 工具结果记录（完整响应，落盘供上下文/重建）。Tool result record. */
export interface ToolResultRecord {
  readonly conversationId: string;
  readonly runId: string;
  readonly turnId?: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly outcome: "ok" | "failed";
  readonly result?: JsonValue;
  readonly errorCode?: string;
  readonly truncated: boolean;
}
