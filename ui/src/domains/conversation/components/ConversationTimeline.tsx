/**
 * ConversationTimeline
 *
 * 按 sequence 排序渲染时间线；新消息到达自动滚到底（用户上滚除外）。
 */
import { useEffect, useRef, useState } from "react";
import type { ConversationTimelineItem as TimelineItem } from "../projection/ConversationTimelineItem.js";
import type { MessageReference } from "./MessageReference.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { UserMessage } from "./UserMessage.js";
import { computeTimelineWindow } from "./timelineWindow.js";
import styles from "./ConversationTimeline.module.css";

const VIRTUALIZE_THRESHOLD = 200;
const ROW_HEIGHT = 56;
const OVERSCAN = 12;

export interface ConversationTimelineProps {
  readonly conversationId: string;
  readonly items: readonly TimelineItem[];
  readonly streamingSequence?: number;
  readonly onMessageReferenceClick?: (reference: MessageReference) => void;
  readonly onProposalAction?: (changeSetId: string, action: "approve" | "reject" | "view-diff") => void;
}

export function ConversationTimeline({
  items,
  streamingSequence,
  onMessageReferenceClick,
  onProposalAction,
}: ConversationTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const sorted = [...items].sort((left, right) => left.sequence - right.sequence);
  const virtualized = sorted.length > VIRTUALIZE_THRESHOLD;
  const timelineWindow = virtualized
    ? computeTimelineWindow({
        itemCount: sorted.length,
        scrollTop,
        viewportHeight,
        rowHeight: ROW_HEIGHT,
        overscan: OVERSCAN,
      })
    : { startIndex: 0, endIndex: sorted.length };
  const visibleItems = sorted.slice(timelineWindow.startIndex, timelineWindow.endIndex);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null || !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [sorted.length, streamingSequence]);

  return (
    <div
      className={styles.timeline}
      ref={scrollRef}
      role="log"
      aria-label="对话时间线"
      onScroll={(event) => {
        const node = event.currentTarget;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        setScrollTop(node.scrollTop);
        setViewportHeight(node.clientHeight);
      }}
    >
      {virtualized ? (
        <div
          style={{ height: timelineWindow.startIndex * ROW_HEIGHT }}
          aria-hidden="true"
        />
      ) : null}
      {visibleItems.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <UserMessage
                key={item.sequence}
                sequence={item.sequence}
                text={item.text}
                timestamp={item.timestamp}
                onReferenceClick={onMessageReferenceClick}
              />
            );
          case "assistant":
            return (
              <AssistantMessage
                key={item.sequence}
                sequence={item.sequence}
                agentLabel={item.agentLabel}
                timestamp={item.timestamp}
                approvalState={item.approvalState}
                revision={item.revision}
                thinkLines={item.thinkLines}
                text={item.text}
                cards={item.cards}
                streaming={item.streaming}
                onCardAction={(cardId, action, payload) => {
                  if (action === "view-diff" && typeof payload === "string") {
                    onProposalAction?.(payload, "view-diff");
                  }
                }}
              />
            );
          case "system":
            return (
              <div key={item.sequence} className={styles.system}>
                {item.text}
              </div>
            );
        }
      })}
      {virtualized ? (
        <div
          style={{ height: (sorted.length - timelineWindow.endIndex) * ROW_HEIGHT }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
