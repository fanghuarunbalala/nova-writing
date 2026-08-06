/**
 * novel.approval.requested → approval 卡投影器。
 * Novel approval-request → approval card projector.
 *
 * core 事件只带 operationIds（无 op 明细），所以本步卡只带标题/meta/changeSetId，
 * ops 明细等 Step 4 审批详情 API。
 *
 * The core event carries only operationIds (no per-op detail), so this step's
 * card carries title/meta/changeSetId only; op details await the Step 4
 * approval-detail API.
 */
import type { PersistedOutputEventSnapshot } from "@novel/core";
import {
  ConversationCardProjectorRegistry,
  type ConversationCardProjection,
  type ConversationCardProjectorRegistration,
} from "../projection/index.js";

export const NOVEL_APPROVAL_REQUESTED_EVENT_TYPE = "novel.approval.requested";

interface NovelApprovalPayload {
  readonly approvalRequestId?: unknown;
  readonly baseRevision?: unknown;
  readonly operationIds?: unknown;
}

/** 把审批请求事件投影为 approval 卡；非本事件返回 undefined。 */
export function novelApprovalRequestedProjector(
  event: PersistedOutputEventSnapshot,
): ConversationCardProjection | undefined {
  if (event.eventType !== NOVEL_APPROVAL_REQUESTED_EVENT_TYPE) return undefined;
  const payload = event.payload as NovelApprovalPayload;
  if (typeof payload.approvalRequestId !== "string" || payload.approvalRequestId === "") {
    return undefined;
  }
  const baseRevision =
    typeof payload.baseRevision === "string" ? payload.baseRevision : "?";
  const operationCount = Array.isArray(payload.operationIds)
    ? payload.operationIds.length
    : 0;
  return Object.freeze({
    cardId: payload.approvalRequestId,
    kind: "approval" as const,
    title: "变更提议",
    summary: `base ${baseRevision} → 待提交 · ${operationCount} 个操作`,
    status: "pending" as const,
  });
}

/** 默认投影器注册工厂（预留 task 等后续投影器插槽）。 */
export function createDefaultConversationCardProjectorRegistry(): ConversationCardProjectorRegistry {
  const registrations: readonly ConversationCardProjectorRegistration[] = Object.freeze([
    {
      eventType: NOVEL_APPROVAL_REQUESTED_EVENT_TYPE,
      projector: novelApprovalRequestedProjector,
    },
  ]);
  return new ConversationCardProjectorRegistry(registrations);
}
