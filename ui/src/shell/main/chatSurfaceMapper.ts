/**
 * chatSurfaceMapper
 *
 * 把 core 投影的 timeline 项映射为域 ConversationTimelineItem。
 * cards 暂为空：结构化卡片投影（legacy ui/src/card）在后续接线。
 */
import type { ConversationProjectionSnapshot } from "@novel/core";
import type { ConversationTimelineItem, ThinkLineData } from "../../domains/conversation/projection/ConversationTimelineItem.js";

export function mapProjectionTimeline(
  projection: ConversationProjectionSnapshot,
  agentLabel: string,
): readonly ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  for (const item of projection.timeline) {
    switch (item.kind) {
      case "user-message":
        items.push({
          kind: "user",
          sequence: item.sequence,
          text: item.text,
          timestamp: Date.parse(item.timestamp) || 0,
        });
        break;
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
        items.push({
          kind: "assistant",
          sequence: item.startedSequence,
          agentLabel,
          timestamp,
          thinkLines,
          text: textParts.join(""),
          cards: Object.freeze([]),
          streaming: item.status === "streaming",
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
