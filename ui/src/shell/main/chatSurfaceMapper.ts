/**
 * chatSurfaceMapper
 *
 * 把 core 投影快照映射为域 ConversationTimelineItem：
 * - turn 分隔（user 消息前插时间标签）
 * - assistant 项的 cards / toolTraces 按事件 seq 范围归属
 *   （[sourceSequence, turnEndSequence]，工具调用常落在消息收口前）
 * - cards：core CardDescriptor（proposal/text）→ UI rich ConversationCardDescriptor
 *
 * 不变量（渲染层依赖）：
 * - 输出保持 core timeline 追加序（turn 分隔插在对应 user 项之前），
 *   ConversationTimeline 不再重排（去 O(T log T) sort）；
 * - 历史 core 项引用稳定（投影仅重建变更项），mapper 按 core 项缓存映射结果，
 *   历史消息的 UI 项/子数组引用跨快照恒定 → React.memo 浅比较命中、零重渲染。
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

/** core 时间线项 → 已映射 UI 项缓存（core 项引用稳定即命中；流式项重建即失效） */
const MAPPED_ITEM_CACHE = new WeakMap<object, readonly ConversationTimelineItem[]>();

export function mapProjectionTimeline(
  projection: ConversationProjectionSnapshot,
  agentLabel: string,
): readonly ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  for (const item of projection.timeline) {
    const cached = MAPPED_ITEM_CACHE.get(item);
    if (cached !== undefined) {
      items.push(...cached);
      continue;
    }
    const mapped: ConversationTimelineItem[] = [];
    if (item.kind === "user") {
      const timestamp = Date.parse(item.timestamp ?? "");
      // turn 分隔：user 消息前插时间标签（时间解析失败用 item sequence 兜底不展示）
      if (!Number.isNaN(timestamp)) {
        mapped.push(
          Object.freeze({
            kind: "turn",
            sequence: item.sequence - 0.5,
            label: formatTime(timestamp),
            timestamp,
          }),
        );
      }
      mapped.push(
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
      mapped.push(
        Object.freeze({
          kind: "assistant",
          sequence: item.sequence,
          agentLabel,
          timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
          text: item.text,
          cards: cardsInRange(projection.cards, from, to),
          streaming: item.streaming === true,
          // 工具行随 core 项的分段结构直接透传（每段 = 内容 + 单行工具，无 seq 过滤）
          segments: item.segments ?? Object.freeze([]),
        }),
      );
    }
    const frozen = Object.freeze(mapped);
    MAPPED_ITEM_CACHE.set(item, frozen);
    items.push(...frozen);
  }
  return Object.freeze(items);
}
