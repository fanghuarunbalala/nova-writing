/** Read-only visible timeline derived exclusively from Core projections. */
import type { ConversationProjectionSnapshot } from "@novel/core";
import {
  ConversationCard,
  captureConversationCardDescriptor,
  emptyConversationCardRendererRegistry,
  type ConversationCardDescriptor,
  type ConversationCardRendererRegistry,
} from "../../card/index.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantMessageItem } from "./AssistantMessageItem.js";
import { ConversationDiagnostics } from "./ConversationDiagnostics.js";
import { ToolApprovalItem } from "./ToolApprovalItem.js";
import { UserMessageItem } from "./UserMessageItem.js";

export interface ConversationTimelineProps {
  readonly projection: ConversationProjectionSnapshot;
  readonly diagnostics?: boolean;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onOpenCardInspector?: (card: ConversationCardDescriptor) => void;
}

export function ConversationTimeline({
  projection,
  diagnostics = false,
  cards = [],
  cardRenderers = emptyConversationCardRendererRegistry,
  onOpenCardInspector,
}: ConversationTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const previousSequence = useRef(projection.lastAppliedSequence);
  const followingLatestRef = useRef(true);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [newEventsAvailable, setNewEventsAvailable] = useState(false);

  const scrollToLatest = useCallback(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
    followingLatestRef.current = true;
    setFollowingLatest(true);
    setNewEventsAvailable(false);
  }, []);

  useEffect(() => {
    const scrollParent = timelineRef.current?.closest(".novel-conversation-content");
    if (!(scrollParent instanceof HTMLElement)) return;
    const handleScroll = () => {
      const atLatest =
        scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight <= 80;
      followingLatestRef.current = atLatest;
      setFollowingLatest(atLatest);
      if (atLatest) setNewEventsAvailable(false);
    };
    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollParent.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (projection.lastAppliedSequence <= previousSequence.current) return;
    previousSequence.current = projection.lastAppliedSequence;
    if (followingLatestRef.current) scrollToLatest();
    else setNewEventsAvailable(true);
  }, [followingLatest, projection.lastAppliedSequence, scrollToLatest]);

  return (
    <div className="novel-conversation-timeline" aria-live="polite" ref={timelineRef}>
      {projection.timeline.length === 0 && cards.length === 0 ? (
        <div className="novel-conversation-empty">开始你的创作对话</div>
      ) : (
        mergeTimeline(projection, cards).map((entry) => {
          if (entry.type === "card") {
            return (
              <ConversationCard
                key={`card:${entry.card.cardId}`}
                card={entry.card}
                registry={cardRenderers}
                onOpenInspector={onOpenCardInspector}
              />
            );
          }
          const item = entry.item;
          if (item.kind === "user-message") {
            return <UserMessageItem key={`user:${item.eventId}`} message={item} />;
          }
          if (item.kind === "assistant-message") {
            return <AssistantMessageItem key={`assistant:${item.assistantMessageId}`} message={item} />;
          }
          return <ToolApprovalItem key={`approval:${item.approvalRequestId}`} approval={item} />;
        })
      )}
      {diagnostics ? <ConversationDiagnostics events={projection.events} /> : null}
      <div className="novel-timeline-end" ref={endRef} />
      {newEventsAvailable ? (
        <button className="novel-follow-latest" type="button" onClick={scrollToLatest}>
          有新消息，回到最新
        </button>
      ) : null}
    </div>
  );
}

function mergeTimeline(
  projection: ConversationProjectionSnapshot,
  cards: readonly ConversationCardDescriptor[],
) {
  const capturedCards = cards.map(captureConversationCardDescriptor);
  if (capturedCards.some((card) => card.conversationId !== projection.conversationId)) {
    throw new TypeError("Conversation Card belongs to another Conversation");
  }
  if (new Set(capturedCards.map((card) => card.cardId)).size !== capturedCards.length) {
    throw new TypeError("Conversation Card id must be unique in Timeline");
  }
  return [
    ...projection.timeline.map((item) => ({
      type: "projection" as const,
      sequence: timelineSequence(item),
      item,
    })),
    ...capturedCards.map((card) => ({
      type: "card" as const,
      sequence: card.sourceSequence,
      card,
    })),
  ].sort((left, right) => left.sequence - right.sequence);
}

function timelineSequence(
  item: ConversationProjectionSnapshot["timeline"][number],
): number {
  if (item.kind === "user-message") return item.sequence;
  if (item.kind === "assistant-message") return item.startedSequence;
  return item.requestedSequence;
}
