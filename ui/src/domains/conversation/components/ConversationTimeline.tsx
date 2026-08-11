/**
 * ConversationTimeline
 *
 * 按 sequence 排序渲染时间线；新消息到达自动滚到底（用户上滚除外）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import type { ReferenceResolver } from "../reference/ReferenceResolver.js";
import type { ConversationTimelineItem as TimelineItem } from "../projection/ConversationTimelineItem.js";
import type { MessageReference } from "./MessageReference.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { DesignCard } from "./DesignCard.js";
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
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (changeSetId: string, action: "approve" | "reject" | "view-diff") => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  readonly onApprovalDecision?: (
    approvalRequestIds: readonly string[],
    decision: "approved" | "rejected",
  ) => void;
  /** 消息内操作提示（如复制结果）；上行到 shell ToastHost。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ConversationTimeline({
  conversationId,
  items,
  streamingSequence,
  onMessageReferenceClick,
  resolveReference,
  onProposalAction,
  onOpenApproval,
  onApprovalDecision,
  onNotify,
}: ConversationTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const sorted = [...items].sort((left, right) => left.sequence - right.sequence);
  // 首条用户消息：复制按钮收进气泡内边距带（原型 .msg-actions-inpad）。
  const firstUserSequence = sorted.find((item) => item.kind === "user")?.sequence;
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
      <div className={styles.inner} key={conversationId}>
        {virtualized ? (
          <div
            style={{ height: timelineWindow.startIndex * ROW_HEIGHT }}
            aria-hidden="true"
          />
        ) : null}
        {visibleItems.map((item, index) => {
          return (
            <div
              key={item.sequence}
              className={styles.enter}
              style={{ animationDelay: `${Math.min(index * 0.03, 0.42)}s` }}
            >
              {renderItem(item, {
                conversationId,
                onMessageReferenceClick,
                resolveReference,
                onProposalAction,
                onOpenApproval,
                onApprovalDecision,
                onNotify,
                firstUserSequence,
              })}
            </div>
          );
        })}
        {virtualized ? (
          <div
            style={{ height: (sorted.length - timelineWindow.endIndex) * ROW_HEIGHT }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}

interface RenderItemDeps {
  readonly conversationId: string;
  readonly onMessageReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (
    changeSetId: string,
    action: "approve" | "reject" | "view-diff",
  ) => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  readonly onApprovalDecision?: (
    approvalRequestIds: readonly string[],
    decision: "approved" | "rejected",
  ) => void;
  /** 消息内操作提示（如复制结果）；上行到 shell ToastHost。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
  /** 时间线中首条用户消息的 sequence（决定复制按钮 inPad 态）。 */
  readonly firstUserSequence?: number;
}

function renderItem(item: TimelineItem, deps: RenderItemDeps): ReactNode {
  const {
    conversationId,
    onMessageReferenceClick,
    resolveReference,
    onProposalAction,
    onOpenApproval,
    onApprovalDecision,
    onNotify,
    firstUserSequence,
  } = deps;
  switch (item.kind) {
    case "turn":
      return (
        <div className={styles.turnSep}>
          <span>{item.label}</span>
        </div>
      );
    case "user":
      return (
        <UserMessage
          sequence={item.sequence}
          text={item.text}
          timestamp={item.timestamp}
          inPad={item.sequence === firstUserSequence}
          onReferenceClick={onMessageReferenceClick}
          resolveReference={resolveReference}
          onNotify={onNotify}
        />
      );
    case "assistant":
      return (
        <AssistantMessage
          sequence={item.sequence}
          agentLabel={item.agentLabel}
          timestamp={item.timestamp}
          approvalState={item.approvalState}
          revision={item.revision}
          failureDetail={item.failureDetail}
          text={item.text}
          cards={item.cards}
          streaming={item.streaming}
          thinking={item.thinking}
          eventFlow={item.eventFlow}
          toolTraces={item.toolTraces}
          onResolveReference={resolveReference}
          onCardAction={(cardId, action, payload) => {
            if (typeof payload !== "string") return;
            if (action === "view-diff") {
              onProposalAction?.(payload, "view-diff");
            } else if (action === "approve") {
              onProposalAction?.(payload, "approve");
            } else if (action === "reject") {
              onProposalAction?.(payload, "reject");
            }
          }}
        />
      );
    case "system":
      return item.approvalRequestId !== undefined && onOpenApproval !== undefined ? (
        <button
          type="button"
          className={styles.systemAction}
          onClick={() => onOpenApproval(item.approvalRequestId as string)}
        >
          {item.text}
        </button>
      ) : (
        <div className={styles.system}>{item.text}</div>
      );
    case "approval":
      return (
        <ApprovalCard
          approval={item.approval}
          designDraft={
            item.approval.toolNames.includes("ExitComposeMode")
              ? { conversationId }
              : undefined
          }
          onApprove={
            onApprovalDecision === undefined
              ? undefined
              : (approvalRequestIds) => onApprovalDecision(approvalRequestIds, "approved")
          }
          onReject={
            onApprovalDecision === undefined
              ? undefined
              : (approvalRequestIds) => onApprovalDecision(approvalRequestIds, "rejected")
          }
          onOpenApproval={
            onOpenApproval === undefined
              ? undefined
              : (approvalRequestId) => onOpenApproval(approvalRequestId)
          }
        />
      );
    case "design":
      return (
        <DesignCard
          conversationId={item.design.conversationId}
          phase={item.design.phase}
        />
      );
  }
}
