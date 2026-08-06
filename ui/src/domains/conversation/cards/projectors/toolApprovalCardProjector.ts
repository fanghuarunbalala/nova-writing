/**
 * system.tool.approval.requested → approval 卡投影器。
 * Tool approval-request → approval card projector.
 *
 * 对齐已确认的写前审批架构（docs/novel-write-approval-plan.md）：审批请求
 * 由工具权限管线产生，摘要（title/description）由写工具 describeOperation 提供。
 *
 * Aligned with the confirmed write-before-approval architecture: approval
 * requests come from the tool permission pipeline, and summaries come from the
 * write tools' describeOperation.
 */
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  ConversationCardProjectorRegistry,
  type ConversationCardProjection,
  type ConversationCardProjectorRegistration,
} from "../projection/index.js";

export const TOOL_APPROVAL_REQUESTED_EVENT_TYPE = "system.tool.approval.requested";

interface ToolApprovalPayload {
  readonly approvalRequestId?: unknown;
  readonly toolName?: unknown;
  readonly summary?: unknown;
}

/** 把工具审批请求事件投影为 approval 卡；非本事件返回 undefined。 */
export function toolApprovalRequestedProjector(
  event: PersistedOutputEventSnapshot,
): ConversationCardProjection | undefined {
  if (event.eventType !== TOOL_APPROVAL_REQUESTED_EVENT_TYPE) return undefined;
  const payload = event.payload as ToolApprovalPayload;
  if (typeof payload.approvalRequestId !== "string" || payload.approvalRequestId === "") {
    return undefined;
  }
  const summary = asSummary(payload.summary);
  const toolName = typeof payload.toolName === "string" ? payload.toolName : "?";
  return Object.freeze({
    cardId: payload.approvalRequestId,
    kind: "approval" as const,
    title: summary.title ?? `工具审批 · ${toolName}`,
    ...(summary.description === undefined
      ? {}
      : { summary: summary.description }),
    status: "pending" as const,
  });
}

function asSummary(
  value: unknown,
): { readonly title?: string; readonly description?: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.title === "string" && record.title !== ""
      ? { title: record.title }
      : {}),
    ...(typeof record.description === "string" && record.description !== ""
      ? { description: record.description }
      : {}),
  };
}

/** 默认投影器注册工厂（当前仅工具审批卡）。 */
export function createDefaultConversationCardProjectorRegistry(): ConversationCardProjectorRegistry {
  const registrations: readonly ConversationCardProjectorRegistration[] = Object.freeze([
    {
      eventType: TOOL_APPROVAL_REQUESTED_EVENT_TYPE,
      projector: toolApprovalRequestedProjector,
    },
  ]);
  return new ConversationCardProjectorRegistry(registrations);
}
