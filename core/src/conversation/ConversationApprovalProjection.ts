/**
 * 跨会话全局审批投影（右上角审批队列数据源）。
 * Global per-conversation approval projection consumed by the approval queue.
 */
import type { JsonValue } from "../event/protocol/index.js";

export type GlobalApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

/** 审批所属会话状态。Owning conversation status. */
export type GlobalApprovalConversationStatus =
  | "active"
  | "archived"
  | "disposed";

/** 审批操作行（与审批事件 summary.operations 同构）。Approval operation row. */
export interface GlobalApprovalOperation {
  readonly op: "add" | "edit" | "delete";
  readonly kind: string;
  readonly id?: string;
  readonly title?: string;
}

/** 一条全局审批（含所属会话）。One approval with its owning conversation. */
export interface GlobalApprovalProjection {
  readonly conversationId: string;
  readonly conversationStatus: GlobalApprovalConversationStatus;
  readonly approvalRequestId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: `sha256:${string}`;
  readonly runId: string;
  readonly turnId?: string;
  readonly title: string;
  readonly description?: string;
  readonly operations?: readonly GlobalApprovalOperation[];
  readonly arguments?: JsonValue;
  readonly status: GlobalApprovalStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly actorId?: string;
  readonly resolvedAt?: string;
}
