/**
 * chatSurfaceMapper
 *
 * 把 core 投影快照映射为域 ConversationTimelineItem：
 * - turn 分隔（user 消息前插时间标签）
 * - assistant 项的 cards / eventFlow / toolTraces 按事件 seq 范围归属
 *   （[sourceSequence, turnEndSequence]，工具调用常落在消息收口前）
 * - cards：core CardDescriptor（proposal/text）→ UI rich ConversationCardDescriptor
 * thinkLines 恒空（reasoning 默认丢弃，只驱动「思考中」状态）。
 */
import type {
  CardDescriptor,
  ConversationProjectionSnapshot,
} from "@novel/core/client";
import type { ConversationCardDescriptor } from "../../domains/conversation/projection/ConversationCardDescriptor.js";
import type { ConversationTimelineItem } from "../../domains/conversation/projection/ConversationTimelineItem.js";

/** core 卡 → UI rich 卡（不伪造变更结构：ops 恒空，tag 按状态映射） */
function toTimelineCard(card: CardDescriptor): ConversationCardDescriptor {
  if (card.kind === "proposal") {
    return Object.freeze({
      kind: "proposal" as const,
      id: card.cardId,
      content: Object.freeze({
        tag: (card.status === "in-progress"
          ? "plan"
          : card.status === "completed"
            ? "applied"
            : "proposal") as "plan" | "proposal" | "applied",
        title: card.title,
        meta: card.toolName,
        ops: Object.freeze([]),
      }),
    });
  }
  return Object.freeze({
    kind: "text" as const,
    id: card.cardId,
    content: Object.freeze({
      richText: Object.freeze({
        kind: "text" as const,
        text: card.summary ?? card.title,
      }),
    }),
  });
}

/** 按事件 seq 范围归属 cards（含起点、含终点） */
function cardsInRange(
  cards: readonly CardDescriptor[],
  from: number,
  to: number,
): readonly ConversationCardDescriptor[] {
  return Object.freeze(
    cards
      .filter((card) => card.sourceSequence >= from && card.sourceSequence <= to)
      .map(toTimelineCard),
  );
}

/** epoch ms → HH:mm 标签 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function mapProjectionTimeline(
  projection: ConversationProjectionSnapshot,
  agentLabel: string,
): readonly ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  for (const item of projection.timeline) {
    if (item.kind === "user") {
      const timestamp = Date.parse(item.timestamp ?? "");
      // turn 分隔：user 消息前插时间标签（时间解析失败用 item sequence 兜底不展示）
      if (!Number.isNaN(timestamp)) {
        items.push(
          Object.freeze({
            kind: "turn",
            sequence: item.sequence - 0.5,
            label: formatTime(timestamp),
            timestamp,
          }),
        );
      }
      items.push(
        Object.freeze({
          kind: "user",
          sequence: item.sequence,
          text: item.text,
          timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
        }),
      );
    } else {
      const from = item.sourceSequence ?? item.sequence;
      const to = item.turnEndSequence ?? from;
      const timestamp = Date.parse(item.timestamp ?? "");
      items.push(
        Object.freeze({
          kind: "assistant",
          sequence: item.sequence,
          agentLabel,
          timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
          thinkLines: Object.freeze([]),
          text: item.text,
          cards: cardsInRange(projection.cards, from, to),
          streaming: item.streaming === true,
          approvalState: (item.streaming === true ? "generating" : "completed") as
            | "generating"
            | "completed",
          eventFlow: Object.freeze(
            projection.eventFlow.filter((e) => e.sequence >= from && e.sequence <= to),
          ),
          toolTraces: Object.freeze(
            projection.toolTraces.filter((t) => t.sequence >= from && t.sequence <= to),
          ),
        }),
      );
    }
  }
  return Object.freeze(items);
}
