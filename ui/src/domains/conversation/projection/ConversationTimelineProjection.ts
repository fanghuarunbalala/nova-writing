/**
 * ConversationTimelineProjection
 *
 * 从用户输入/助手草稿/系统事件构建 timeline item 的纯辅助函数。
 */
import type { AssistantDraftProjection } from "./AssistantDraftProjection.js";
import { assistantDraftText } from "./AssistantDraftProjection.js";
import type { ConversationTimelineItem } from "./ConversationTimelineItem.js";
import type { ConversationCardDescriptor } from "./ConversationCardDescriptor.js";

export const ConversationTimelineProjection = {
  buildUserItem(
    sequence: number,
    text: string,
    timestamp: number,
  ): ConversationTimelineItem {
    return Object.freeze({ kind: "user", sequence, text, timestamp });
  },

  buildAssistantItem(
    projection: AssistantDraftProjection,
    options: {
      readonly agentLabel: string;
      readonly timestamp: number;
      readonly cards?: readonly ConversationCardDescriptor[];
    },
  ): ConversationTimelineItem {
    const cards = options.cards ?? Object.freeze([]);
    return Object.freeze({
      kind: "assistant",
      sequence: projection.sequence,
      agentLabel: options.agentLabel,
      timestamp: options.timestamp,
      text: assistantDraftText(projection),
      cards,
      streaming: projection.phase === "streaming",
    });
  },

  buildSystemItem(sequence: number, text: string, timestamp: number): ConversationTimelineItem {
    return Object.freeze({ kind: "system", sequence, text, timestamp });
  },
};
