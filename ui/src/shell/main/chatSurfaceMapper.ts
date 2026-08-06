/**
 * chatSurfaceMapper
 *
 * 把 core 投影的 timeline 项映射为域 ConversationTimelineItem。
 * 结构化卡片：binding 快照的 generic 卡（ConversationCardProjectionStore 产出）
 * 按 sourceSequence 归属到对应 assistant 消息，并映射为 rich 描述供渲染器使用。
 */
import type { ConversationProjectionSnapshot } from "@novel/core";
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
        const eventFlow = projection.events
          .filter(
            (event) =>
              event.direction === "output" &&
              event.sequence >= item.startedSequence &&
              event.sequence <= item.lastSequence,
          )
          .map(toEventView);
        const toolTraces = projection.toolTraces
          .filter(
            (trace) =>
              trace.sequence >= item.startedSequence &&
              trace.sequence <= item.lastSequence,
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
      case "tool-approval":
        items.push({
          kind: "system",
          sequence: item.requestedSequence,
          text: `等待审批：${item.title}`,
          timestamp: Date.parse(item.requestedAt) || 0,
        });
        break;
    }
  }
  return Object.freeze(items);
}

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
    case "approval":
      return {
        kind: "proposal",
        id: card.cardId,
        content: {
          tag: "proposal",
          title: card.title,
          ...(card.summary !== undefined ? { meta: card.summary } : {}),
          changeSetId: card.cardId,
          ops: Object.freeze([]),
        },
      };
    default:
      return null;
  }
}
