/**
 * ScheduleProjection
 *
 * 计划域的纯派生函数：stats / todos / progressTree。
 * 说明：审批类待办由 deriveApprovalTodos 从 shell 级 ApprovalStore 快照
 * （api.conversations.listApprovals()）派生。
 */
import type { ApprovalQueueItem } from "@novel/core";
import type { ConversationCatalogSnapshot } from "../../conversation/store/ConversationCatalogStore.js";
import type { NovelOverviewSnapshot } from "../../novel/overview/NovelOverviewStore.js";
import type { StoryOutlineTreeNode } from "../../novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeSnapshot } from "../../novel/outline/store/StoryOutlineTreeStore.js";

export interface ScheduleStatData {
  readonly id: string;
  readonly num: number;
  readonly label: string;
  readonly note: string;
  readonly variant?: "default" | "danger" | "warn";
}

export interface ScheduleTodoData {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly tag: "decision" | "approval" | "profile" | "writing";
  readonly status: "open" | "done";
  readonly action?: {
    readonly label: string;
    readonly kind: "open-approval" | "open-character" | "open-location";
  };
}

export interface ScheduleProgressUnitData {
  readonly unitId: string;
  readonly label: string;
  readonly depth: number;
  readonly planM: 1 | 2 | 3;
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
  readonly progress?: { readonly completed: number; readonly total: number };
  readonly blockedReason?: string;
  readonly abandonedReason?: string;
}

export const ScheduleProjection = {
  deriveStats(
    overview: NovelOverviewSnapshot,
    outline: StoryOutlineTreeSnapshot,
  ): readonly ScheduleStatData[] {
    const stats: ScheduleStatData[] = [
      { id: "story-units", num: overview.counts.storyUnitCount, label: "大纲单元", note: "arc + scene" },
      { id: "characters", num: overview.counts.characterCount, label: "角色", note: "已建档" },
      { id: "locations", num: overview.counts.locationCount, label: "地点", note: "已建档" },
      { id: "chapters", num: overview.counts.chapterCount, label: "章节", note: "出版结构" },
      { id: "paragraphs", num: overview.counts.paragraphCount, label: "段落", note: "正文" },
    ];
    const progress = collectOutlineProgress(outline.tree);
    if (progress.total > 0) {
      stats.push({
        id: "progress",
        num: progress.completed,
        label: "已完成单元",
        note: `共 ${progress.total}`,
        ...(progress.completed < progress.total ? { variant: "warn" as const } : {}),
      });
    }
    return Object.freeze(stats);
  },

  deriveTodos(
    novel: NovelOverviewSnapshot,
    conversation: ConversationCatalogSnapshot,
  ): readonly ScheduleTodoData[] {
    const todos: ScheduleTodoData[] = [];
    if (novel.phase === "ready" && novel.counts.characterCount === 0) {
      todos.push({
        id: "profile-characters",
        title: "建立角色档案",
        meta: "还没有角色",
        tag: "profile",
        status: "open",
        action: { label: "去角色", kind: "open-character" },
      });
    }
    if (novel.phase === "ready" && novel.counts.locationCount === 0) {
      todos.push({
        id: "profile-locations",
        title: "建立地点档案",
        meta: "还没有地点",
        tag: "profile",
        status: "open",
        action: { label: "去地点", kind: "open-location" },
      });
    }
    if (conversation.phase === "ready" && conversation.conversations.length === 0) {
      todos.push({
        id: "writing-first-conversation",
        title: "发起第一次对话",
        meta: "还没有对话",
        tag: "writing",
        status: "open",
      });
    }
    return Object.freeze(todos);
  },

  /**
   * 审批类待办：每个 pending 工具审批生成一条待办，动作打开右侧审批面板
   * （ApplicationShell.handleTodoAction 路由 open-approval → handleOpenApproval）。
   */
  deriveApprovalTodos(
    approvals: readonly ApprovalQueueItem[],
  ): readonly ScheduleTodoData[] {
    const todos: ScheduleTodoData[] = [];
    for (const approval of approvals) {
      if (approval.status !== "pending") continue;
      const label =
        approval.toolCalls.length > 1
          ? `${approval.toolCalls[0]!.toolName} 等 ${approval.toolCalls.length} 项`
          : approval.toolCalls[0]!.toolName;
      todos.push({
        id: approval.requestId,
        title: label,
        meta: label,
        tag: "approval",
        status: "open",
        action: { label: "去审批", kind: "open-approval" },
      });
    }
    return Object.freeze(todos);
  },

  deriveProgressTree(
    outline: StoryOutlineTreeSnapshot,
  ): readonly ScheduleProgressUnitData[] {
    const walk = (
      nodes: readonly StoryOutlineTreeNode[],
      depth: number,
      into: ScheduleProgressUnitData[],
    ): void => {
      for (const node of nodes) {
        into.push({
          unitId: node.unitId,
          label: node.title,
          depth,
          planM:
            node.planningStatus === "idea" ? 1 : node.planningStatus === "outlined" ? 2 : 3,
          realNode: node.realization,
          ...(node.progress !== undefined ? { progress: node.progress } : {}),
          ...(node.blockedReason !== undefined ? { blockedReason: node.blockedReason } : {}),
          ...(node.abandonedReason !== undefined ? { abandonedReason: node.abandonedReason } : {}),
        });
        walk(node.children, depth + 1, into);
      }
    };
    const result: ScheduleProgressUnitData[] = [];
    walk(outline.tree, 0, result);
    return Object.freeze(result);
  },
};

function collectOutlineProgress(
  tree: readonly StoryOutlineTreeNode[],
): { readonly completed: number; readonly total: number } {
  let completed = 0;
  let total = 0;
  const walk = (nodes: readonly StoryOutlineTreeNode[]): void => {
    for (const node of nodes) {
      if (node.realization === "completed") completed += 1;
      total += 1;
      walk(node.children);
    }
  };
  walk(tree);
  return { completed, total };
}
