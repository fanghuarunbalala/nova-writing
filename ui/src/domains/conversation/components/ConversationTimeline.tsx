/**
 * ConversationTimeline
 *
 * 按 sequence 排序渲染时间线；新消息到达自动滚到底（用户上滚除外）。
 */
import { useEffect, useRef } from "react";
import type { ConversationTimelineItem as TimelineItem } from "../projection/ConversationTimelineItem.js";
import type { MessageReference } from "./MessageReference.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { UserMessage } from "./UserMessage.js";
import styles from "./ConversationTimeline.module.css";

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
  const sorted = [...items].sort((left, right) => left.sequence - right.sequence);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null || !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [sorted.length, streamingSequence]);

  return (
    <div
      className={styles.timeline}
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      {sorted.map((item) => {
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
    </div>
  );
}
