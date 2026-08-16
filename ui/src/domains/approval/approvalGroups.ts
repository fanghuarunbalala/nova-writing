/**
 * approvalGroups
 *
 * 审批分组投影（弹窗左清单与详情共用）：一组 = `${conversationId}:${requestId}`
 * （一次审批请求及其重试），组内整批决策（core WaitRequestQueue 粒度）。
 * ExitComposeMode 组固定标题「提交设计草稿」。
 */
import type { ApprovalQueueItem } from "@novel/core";
import type { JsonObject, JsonValue } from "./jsonTypes.js";
import { toolNameLabel } from "./paramLabels.js";

export interface ApprovalGroup {
  readonly key: string;
  readonly approvals: readonly ApprovalQueueItem[];
  readonly status: ApprovalQueueItem["status"];
  readonly requestedAt: string;
  /** 组标题（由首条审批 args 解析，group 级一次计算，避免渲染期 JSON.parse）。 */
  readonly title: string;
}

export const APPROVAL_STATUS_LABEL: Record<ApprovalQueueItem["status"], string> = {
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
  edited: "已修改",
  expired: "已过期",
};

/** ExitComposeMode 审批（设计草稿全文，详情区改渲染 design 文件）。 */
export function isExitComposeGroup(group: ApprovalGroup): boolean {
  return group.approvals[0]?.toolCalls[0]?.toolName === "ExitComposeMode";
}

/** args JSON 字符串 → JsonValue（解析失败 undefined → 走「无参数详情」降级） */
export function parseApprovalArgs(args: string): JsonValue | undefined {
  try {
    return JSON.parse(args) as JsonValue;
  } catch {
    return undefined;
  }
}

/** 审批标题派生：从 args 提取实体名（写：values[0].name/title；编辑：patch.name；删除：id） */
function approvalTitleOf(toolName: string, args: string): string {
  const parsed = parseApprovalArgs(args);
  const fallback = toolNameLabel(toolName) ?? toolName;
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
    return fallback;
  }
  const record = parsed as JsonObject;
  if (Array.isArray(record.values) && record.values.length > 0) {
    const first = record.values[0];
    if (typeof first === "object" && first !== null) {
      const item = first as JsonObject;
      const name =
        (typeof item.name === "string" ? item.name : undefined) ??
        (typeof item.title === "string" ? item.title : undefined);
      if (name !== undefined) return name;
      const patch = item.patch;
      if (typeof patch === "object" && patch !== null) {
        const patchName = (patch as JsonObject).name;
        if (typeof patchName === "string") return patchName;
      }
    }
  }
  // 单对象形态（ParagraphWrite/OutlineWrite/PublicationWrite 等）
  if (typeof record.name === "string") return record.name;
  if (typeof record.title === "string") return record.title;
  return fallback;
}

function groupKeyOf(approval: ApprovalQueueItem): string {
  return `${approval.conversationId}:${approval.requestId}`;
}

function groupStatus(approvals: readonly ApprovalQueueItem[]): ApprovalQueueItem["status"] {
  if (approvals.some((item) => item.status === "pending")) return "pending";
  if (approvals.some((item) => item.status === "rejected")) return "rejected";
  return approvals[approvals.length - 1]!.status;
}

export function groupApprovals(approvals: readonly ApprovalQueueItem[]): readonly ApprovalGroup[] {
  const raw = new Map<string, ApprovalQueueItem[]>();
  for (const approval of approvals) {
    const key = groupKeyOf(approval);
    const list = raw.get(key) ?? [];
    list.push(approval);
    raw.set(key, list);
  }
  return Object.freeze(
    [...raw.entries()]
      .map(([key, list]) =>
        Object.freeze({
          key,
          approvals: Object.freeze(list),
          status: groupStatus(list),
          requestedAt: list[0]!.requestedAt,
          title:
            list[0]!.toolCalls[0]!.toolName === "ExitComposeMode"
              ? "提交设计草稿"
              : approvalTitleOf(list[0]!.toolCalls[0]!.toolName, list[0]!.toolCalls[0]!.args),
        }),
      )
      // 最新审批在前，打开弹窗时默认看到最新的待审组。
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
  );
}
