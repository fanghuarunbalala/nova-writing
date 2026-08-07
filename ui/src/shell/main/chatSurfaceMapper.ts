/**
 * chatSurfaceMapper
 *
 * 把 core 投影的 timeline 项映射为域 ConversationTimelineItem。
 * 结构化卡片：binding 快照的 generic 卡（ConversationCardProjectionStore 产出）
 * 按 sourceSequence 归属到对应 assistant 消息，并映射为 rich 描述供渲染器使用。
 */
import type {
  ConversationProjectionSnapshot,
  ToolApprovalProjection,
} from "@novel/core";
import type { ConversationCardDescriptor as GenericCardDescriptor } from "../../domains/conversation/cards/projection/index.js";
import type { ConversationCardDescriptor } from "../../domains/conversation/projection/ConversationCardDescriptor.js";
import type {
  ConversationEventView,
  ConversationTimelineItem,
  ThinkLineData,
  ToolTraceView,
} from "../../domains/conversation/projection/ConversationTimelineItem.js";

export function mapProjectionTimeline(
  projection: ConversationProjectionSnapshot,
  cards: readonly GenericCardDescriptor[],
  agentLabel: string,
): readonly ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  const approvalGroups = groupApprovalRequests(projection.timeline);
  const emittedApprovalGroups = new Set<string>();
  let turnNumber = 0;
  for (const item of projection.timeline) {
    switch (item.kind) {
      case "user-message": {
        turnNumber += 1;
        const timestamp = Date.parse(item.timestamp) || 0;
        items.push({
          kind: "turn",
          sequence: item.sequence - 0.5,
          label: `第 ${turnNumber} 轮 · ${formatTime(timestamp)}`,
          timestamp,
        });
        items.push({
          kind: "user",
          sequence: item.sequence,
          text: item.text,
          timestamp,
        });
        break;
      }
      case "assistant-message": {
        const timestamp = Date.parse(item.timestamp) || 0;
        const textParts: string[] = [];
        const thinkLines: ThinkLineData[] = [];
        for (const part of item.content) {
          if (part.type === "text") textParts.push(part.text);
          else {
            thinkLines.push({
              id: `${item.assistantMessageId}-${thinkLines.length}`,
              text: part.thinking,
            });
          }
        }
        const messageCards = cards
          .filter(
            (card) =>
              card.sourceSequence >= item.startedSequence &&
              card.sourceSequence <= item.lastSequence,
          )
          .map(toTimelineCard)
          .filter((card): card is ConversationCardDescriptor => card !== null);
        // 工具调用常发生在消息 completed 之后、同一 turn 内（turn 边界由
        // turn.state.changed 的 lastSequence 界定），因此事件流/工具条范围取
        // 到 turn 结束，而不是消息自己的 lastSequence。
        const turnEnd =
          projection.turns.find(
            (turn) => turn.runId === item.runId && turn.turnId === item.turnId,
          )?.lastSequence ?? item.lastSequence;
        const eventFlow = eventFlowOf(projection, item.startedSequence, turnEnd);
        const toolTraces = projection.toolTraces
          .filter(
            (trace) =>
              trace.sequence >= item.startedSequence &&
              trace.sequence <= turnEnd,
          )
          .map(toTraceView);
        items.push({
          kind: "assistant",
          sequence: item.startedSequence,
          agentLabel,
          timestamp,
          thinkLines,
          text: textParts.join(""),
          cards: Object.freeze(messageCards),
          streaming: item.status === "streaming",
          eventFlow: Object.freeze(eventFlow),
          toolTraces: Object.freeze(toolTraces),
          ...(item.status === "streaming" ? { approvalState: "generating" as const } : {}),
          ...(item.status === "completed" ? { approvalState: "completed" as const } : {}),
          ...(item.status === "failed" ? { approvalState: "failed" as const } : {}),
          ...(item.status === "cancelled" ? { approvalState: "cancelled" as const } : {}),
        });
        break;
      }
      case "tool-approval": {
        const groupKey = item.turnId ?? `req-${item.approvalRequestId}`;
        if (emittedApprovalGroups.has(groupKey)) break;
        emittedApprovalGroups.add(groupKey);
        const group = approvalGroups.get(groupKey);
        if (group === undefined) break;
        items.push(toApprovalCardItem(group, groupKey));
        break;
      }
    }
  }
  return Object.freeze(items);
}

/** 同一 turn 的工具审批合并为一组（无 turnId 时各自成组）。Group by turn. */
function groupApprovalRequests(
  timeline: ConversationProjectionSnapshot["timeline"],
): Map<string, readonly ToolApprovalProjection[]> {
  const groups = new Map<string, ToolApprovalProjection[]>();
  for (const item of timeline) {
    if (item.kind !== "tool-approval") continue;
    const key = item.turnId ?? `req-${item.approvalRequestId}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function groupApprovalStatus(
  group: readonly ToolApprovalProjection[],
): ToolApprovalProjection["status"] {
  if (group.some((item) => item.status === "pending")) return "pending";
  if (group.some((item) => item.status === "rejected")) return "rejected";
  return group[group.length - 1].status;
}

function toApprovalCardItem(
  group: readonly ToolApprovalProjection[],
  groupKey: string,
): ConversationTimelineItem {
  const operations = Object.freeze(
    group.flatMap((item) =>
      (item.operations ?? []).map((operation) =>
        Object.freeze({ ...operation, toolName: item.toolName }),
      ),
    ),
  );
  const toolNames = Object.freeze([
    ...new Set(group.map((item) => item.toolName)),
  ]);
  const argumentGroups = Object.freeze(
    group.map((item) =>
      Object.freeze({
        toolName: item.toolName,
        ...(item.arguments === undefined
          ? {}
          : { arguments: item.arguments }),
      }),
    ),
  );
  const requestedAt = group[0].requestedAt;
  return Object.freeze({
    kind: "approval" as const,
    sequence: Math.min(...group.map((item) => item.requestedSequence)),
    timestamp: Date.parse(requestedAt) || 0,
    approval: Object.freeze({
      groupKey,
      approvalRequestIds: Object.freeze(group.map((item) => item.approvalRequestId)),
      toolNames,
      title: group[0].title,
      ...(group[0].description === undefined
        ? {}
        : { description: group[0].description }),
      operations,
      argumentGroups,
      status: groupApprovalStatus(group),
      requestedAt,
    }),
  });
}

const DELTA_EVENT_TYPE = "agent.assistant.message.delta";
const TOOL_TRACE_EVENT_TYPE = "system.tool.trace.recorded";
const TERMINAL_TRACE_STAGES = new Set([
  "execution_completed",
  "execution_failed",
  "timed_out",
  "cancelled",
]);
const TERMINAL_STAGE_LABEL: Record<string, string> = {
  execution_completed: "完成",
  execution_failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
};

function toEventView(
  event: ConversationProjectionSnapshot["events"][number],
): ConversationEventView {
  return Object.freeze({
    sequence: event.sequence,
    timestamp: Date.parse(event.timestamp) || 0,
    eventType: event.eventType,
    family: familyOf(event.eventType),
    ...(event.summary === undefined ? {} : { summary: event.summary }),
  });
}

/** 事件流只保留终态工具 trace：delta 与中间阶段均不进事件流。 */
function eventFlowOf(
  projection: ConversationProjectionSnapshot,
  startedSequence: number,
  lastSequence: number,
): readonly ConversationEventView[] {
  const views = projection.events
    .filter(
      (event) =>
        event.direction === "output" &&
        event.sequence >= startedSequence &&
        event.sequence <= lastSequence &&
        event.eventType !== DELTA_EVENT_TYPE &&
        event.eventType !== TOOL_TRACE_EVENT_TYPE,
    )
    .map(toEventView);
  const terminalTraces = projection.toolTraces
    .filter(
      (trace) =>
        trace.sequence >= startedSequence &&
        trace.sequence <= lastSequence &&
        trace.stage !== undefined &&
        TERMINAL_TRACE_STAGES.has(trace.stage),
    )
    .map((trace) => toTerminalTraceView(trace));
  return Object.freeze(
    [...views, ...terminalTraces].sort((left, right) => left.sequence - right.sequence),
  );
}

function toTerminalTraceView(
  trace: ConversationProjectionSnapshot["toolTraces"][number],
): ConversationEventView {
  const failed =
    trace.stage !== undefined &&
    (trace.stage === "execution_failed" ||
      trace.stage === "timed_out" ||
      trace.stage === "cancelled");
  const stageLabel = trace.stage === undefined ? "完成" : TERMINAL_STAGE_LABEL[trace.stage] ?? trace.stage;
  return Object.freeze({
    sequence: trace.sequence,
    timestamp: Date.parse(trace.timestamp) || 0,
    eventType: TOOL_TRACE_EVENT_TYPE,
    family: "system",
    summary: `工具 ${trace.toolName} · ${stageLabel}`,
    outcome: failed ? "failed" : "ok",
  });
}

function toTraceView(
  trace: ConversationProjectionSnapshot["toolTraces"][number],
): ToolTraceView {
  return Object.freeze({
    traceId: trace.traceId,
    toolName: trace.toolName,
    ...(trace.stage === undefined ? {} : { stage: trace.stage }),
    outcome: trace.outcome,
    ...(trace.durationMs === undefined ? {} : { durationMs: trace.durationMs }),
  });
}

function familyOf(eventType: string): ConversationEventView["family"] {
  if (eventType.startsWith("agent.")) return "agent";
  if (eventType.startsWith("novel.")) return "novel";
  if (eventType.startsWith("system.")) return "system";
  return "other";
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** generic 卡 → rich 渲染描述；暂不支持的 kind 返回 null。 */
function toTimelineCard(
  card: GenericCardDescriptor,
): ConversationCardDescriptor | null {
  switch (card.kind) {
    default:
      return null;
  }
}
