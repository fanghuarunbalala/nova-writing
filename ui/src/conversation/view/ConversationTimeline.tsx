/** Read-only visible timeline derived exclusively from Core projections. */
import type { ConversationProjectionSnapshot } from "@novel/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantMessageItem } from "./AssistantMessageItem.js";
import { ConversationDiagnostics } from "./ConversationDiagnostics.js";
import { ToolApprovalItem } from "./ToolApprovalItem.js";
import { UserMessageItem } from "./UserMessageItem.js";

export interface ConversationTimelineProps {
  readonly projection: ConversationProjectionSnapshot;
  readonly diagnostics?: boolean;
}

export function ConversationTimeline({ projection, diagnostics = false }: ConversationTimelineProps) {
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
      {projection.timeline.length === 0 ? (
        <div className="novel-conversation-empty">开始你的创作对话</div>
      ) : (
        projection.timeline.map((item) => {
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
