/**
 * chatSurfaceMapper
 *
 * 把精简投影的 timeline 项（core 的 {kind, text, streaming}）映射为域 ConversationTimelineItem。
 * cards/thinkLines/eventFlow/toolTraces 延后，恒为空。
 */
import type { ConversationTimelineItem as CoreTimelineItem } from "@novel/core/client";
import type { ConversationTimelineItem } from "../../domains/conversation/projection/ConversationTimelineItem.js";

export function mapProjectionTimeline(
  timeline: readonly CoreTimelineItem[],
  agentLabel: string,
): readonly ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  for (const item of timeline) {
    if (item.kind === "user") {
      items.push(
        Object.freeze({
          kind: "user",
          sequence: item.sequence,
          text: item.text,
          timestamp: 0,
        }),
      );
    } else {
      items.push(
        Object.freeze({
          kind: "assistant",
          sequence: item.sequence,
          agentLabel,
          timestamp: 0,
          thinkLines: Object.freeze([]),
          text: item.text,
          cards: Object.freeze([]),
          streaming: item.streaming === true,
          ...(item.streaming === true
            ? { approvalState: "generating" as const }
            : { approvalState: "completed" as const }),
        }),
      );
    }
  }
  return Object.freeze(items);
}
