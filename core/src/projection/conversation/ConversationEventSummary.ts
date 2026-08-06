/**
 * 输出事件 → 脱敏中文摘要。
 * Output event → redacted Chinese summary.
 *
 * 仅用于对话内运行时时序展示：只取 id/状态/计数/修订号等稳定元数据，
 * **绝不**取正文、prompt、工具参数、凭据等敏感内容。
 *
 * Used only for the in-chat runtime event flow: reads stable metadata such as
 * ids, statuses, counts, and revisions. Never includes prose, prompts, tool
 * arguments, credentials, or other sensitive content.
 */
import { OUTPUT_EVENT_TYPE } from "../../event/index.js";
import type { PersistedConversationEventSnapshot } from "../../storage/index.js";

export function summarizeConversationEvent(
  event: PersistedConversationEventSnapshot,
): string | undefined {
  if (event.direction !== "output") return undefined;
  const payload = event.payload as Record<string, unknown>;
  switch (event.eventType) {
    case OUTPUT_EVENT_TYPE.runtimePresenceChanged:
      return `${stateOf(payload.previous)} → ${stateOf(payload.current)}`;
    case OUTPUT_EVENT_TYPE.hostInputRouted:
      return `指令 → ${str(payload.handler) ?? "?"} · ${str(payload.outcome) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.runtimeInputProcessed:
      return `终端 ${str(payload.outcome) ?? "completed"}`;
    case OUTPUT_EVENT_TYPE.agentRunStateChanged:
      return `${str(payload.previous) ?? "—"} → ${str(payload.current) ?? "?"} · ${str(payload.reason) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.agentTurnStateChanged:
      return `${str(payload.previous) ?? "—"} → ${str(payload.current) ?? "?"} · ${str(payload.reason) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.agentAssistantMessageStarted:
      return `消息 ${str(payload.assistantMessageId) ?? "?"} 开始`;
    case OUTPUT_EVENT_TYPE.agentAssistantMessageDelta:
      return "增量更新";
    case OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted:
      return `completionReason ${str(payload.completionReason) ?? "?"} · hasToolCalls ${payload.hasToolCalls === true ? "true" : "false"}`;
    case OUTPUT_EVENT_TYPE.agentAssistantMessageFailed:
      return `失败 ${str(payload.failureCode) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled:
      return "已取消";
    case OUTPUT_EVENT_TYPE.agentTodoUpdated:
      return `待办快照 ${arrayLength(payload.todos)} 项 · revision ${int(payload.revision)}`;
    case OUTPUT_EVENT_TYPE.agentWorkItemsUpdated:
      return `任务快照 ${arrayLength(payload.items)} 项`;
    case OUTPUT_EVENT_TYPE.subagentStarted:
      return `子代理 ${str(payload.subagentId) ?? "?"} 开始`;
    case OUTPUT_EVENT_TYPE.subagentProgress:
      return `子代理 ${str(payload.subagentId) ?? "?"} · ${str(payload.progressCode) ?? "progress"}`;
    case OUTPUT_EVENT_TYPE.subagentCompleted:
      return `子代理 ${str(payload.subagentId) ?? "?"} 完成`;
    case OUTPUT_EVENT_TYPE.subagentFailed:
      return `子代理 ${str(payload.subagentId) ?? "?"} 失败`;
    case OUTPUT_EVENT_TYPE.subagentCancelled:
      return `子代理 ${str(payload.subagentId) ?? "?"} 取消`;
    case OUTPUT_EVENT_TYPE.toolTraceRecorded:
      return `工具 ${str(payload.toolName) ?? "?"} · ${str(payload.stage) ?? "execute"}`;
    case OUTPUT_EVENT_TYPE.toolApprovalRequested:
      return `工具审批请求 · ${str(payload.toolName) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.toolApprovalResolved:
      return `工具审批 ${str(payload.decision) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.nudgeScheduled:
      return `待办提醒已排期 · ${str(payload.nudgeId) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.nudgeExpired:
      return `待办提醒过期 · ${str(payload.nudgeId) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.systemReminderInjected:
      return `系统提醒注入 · ${str(payload.kind) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.systemReminderAttached:
      return `系统提醒附加 · ${str(payload.kind) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.contextCompactionStarted:
      return `上下文压缩开始 · ${str(payload.trigger) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.contextCompactionCompleted:
      return `上下文压缩完成 · ${str(payload.outcome) ?? "?"}`;
    case OUTPUT_EVENT_TYPE.contextCompactionFailed:
      return "上下文压缩失败";
    case OUTPUT_EVENT_TYPE.contextCheckpointApplied:
      return `检查点已应用 · ${str(payload.checkpointId) ?? "?"}`;
    default:
      return summarizeNovelLifecycle(event.eventType, payload);
  }
}

function summarizeNovelLifecycle(
  eventType: string,
  payload: Record<string, unknown>,
): string | undefined {
  switch (eventType) {
    case "novel.draft.started":
      return `草稿会话 ${str(payload.draftSessionId) ?? "?"} 启动 · base ${str(payload.baseRevision) ?? "?"}`;
    case "novel.draft.status.changed":
      return `草稿状态 ${str(payload.previousStatus) ?? "?"} → ${str(payload.currentStatus) ?? "?"}`;
    case "novel.draft.rolled.back":
      return `草稿回滚 · base ${str(payload.baseRevision) ?? "?"}`;
    case "novel.draft.operation.applied":
      return `草稿操作 ${str(payload.operationId) ?? "?"} · ${str(payload.operationType) ?? "?"}`;
    case "novel.commit.completed":
      return `提交 ${str(payload.commitId) ?? "?"} · ${int(payload.operationCount)} 个操作 → ${str(payload.resultRevision) ?? "?"}`;
    case "novel.commit.recovered":
      return `提交恢复 · ${str(payload.recovery) ?? "?"}`;
    case "novel.rebase.prepared":
      return `rebase 准备 · 候选 ${str(payload.candidateDraftSessionId) ?? "?"}`;
    case "novel.rebase.conflicted":
      return `rebase 冲突 ${int(payload.conflictCount)} 处`;
    case "novel.rebase.resolved":
      return `rebase 已解决 · 生效 ${int(payload.effectiveOperationCount)} 个操作`;
    case "novel.rebase.promoted":
      return "rebase 已并入主线";
    case "novel.conflict.detected":
      return `冲突 ${str(payload.conflictId) ?? "?"} · ${str(payload.kind) ?? "?"}`;
    case "novel.conflict.resolved":
      return `冲突已解决 · ${str(payload.strategy) ?? "?"}`;
    case "novel.recovery.completed":
      return `恢复完成 · ${str(payload.scope) ?? "?"} · ${str(payload.outcome) ?? "?"}`;
    case "novel.approval.requested":
      return `审批请求 ${str(payload.approvalRequestId) ?? "?"} · base ${str(payload.baseRevision) ?? "?"} · ${arrayLength(payload.operationIds)} 个操作`;
    default:
      return undefined;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stateOf(value: unknown): string {
  if (value === null || typeof value !== "object") return "?";
  const state = (value as Record<string, unknown>).state;
  return str(state) ?? "?";
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
