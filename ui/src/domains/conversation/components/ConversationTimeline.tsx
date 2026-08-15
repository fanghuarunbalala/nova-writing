/**
 * ConversationTimeline
 *
 * 按 mapper 输出追加序渲染时间线（chatSurfaceMapper 保证序不变量，不重排）；
 * 新消息到达自动滚到底（用户上滚除外）。
 * 虚拟化走 CSS content-visibility（gui-performance-2 功能点六）：视口外行
 * 跳过 layout/paint，滚动位置由 contain-intrinsic-size 估高支撑——无固定行高
 * 失真、无窗口重挂载闪烁；滚动路径零 setState（仅 ref 记忆贴底状态）。
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { debugLog } from "@novel/core/client";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import type { ReferenceResolver } from "../reference/ReferenceResolver.js";
import type { ConversationTimelineItem as TimelineItem } from "../projection/ConversationTimelineItem.js";
import type { MessageReference } from "./MessageReference.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { DesignCard } from "./DesignCard.js";
import { UserMessage } from "./UserMessage.js";
import styles from "./ConversationTimeline.module.css";

export interface ConversationTimelineProps {
  readonly conversationId: string;
  readonly items: readonly TimelineItem[];
  readonly streamingSequence?: number;
  readonly onMessageReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (changeSetId: string, action: "approve" | "reject" | "view-diff") => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
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
  onNotify,
}: ConversationTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // 首条用户消息：复制按钮收进气泡内边距带（原型 .msg-actions-inpad）。
  const firstUserSequence = items.find((item) => item.kind === "user")?.sequence;
  // 流式正文增长（贴底跟随依据）：末项文本长度随发布递增
  const lastItemTextLength = (() => {
    const last = items.at(-1);
    return last !== undefined && "text" in last ? last.text.length : 0;
  })();

  // 卡片动作回调稳定引用（AssistantMessage memo 浅比较依赖）
  const handleCardAction = useCallback(
    (cardId: string, action: string, payload?: unknown) => {
      // 卡片富文本引用（RichTextRenderer）：payload 为 {refKind,id,label} 对象，
      // 转 MessageReference 复用正文 cc:// 引用的跳转链路（Inspector/正文定位）。
      if (action === "reference") {
        if (payload === null || typeof payload !== "object") return;
        const { refKind, id, label } = payload as {
          refKind: "character" | "location" | "outline";
          id: string;
          label?: string;
        };
        if (typeof id !== "string") return;
        onMessageReferenceClick?.({
          refKind,
          id,
          ...(label === undefined ? {} : { label }),
        });
        return;
      }
      if (typeof payload !== "string") return;
      if (action === "view-diff") {
        onProposalAction?.(payload, "view-diff");
      } else if (action === "approve") {
        onProposalAction?.(payload, "approve");
      } else if (action === "reject") {
        onProposalAction?.(payload, "reject");
      }
    },
    [onProposalAction, onMessageReferenceClick],
  );

  // 贴底跟随：新消息 / persist 序号 / 流式正文增长时滚到底（用户上滚除外）
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null || !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
    logWrapDiag("publish");
  }, [items.length, streamingSequence, lastItemTextLength]);

  // ============ TEMP-DIAG（断字换行排查，verbose 门控，定位后整体移除） ============
  // 嫌疑：正文流式写入与主区宽度变化（审批面板 margin-right 过渡）时序重叠，
  // 首行在窄宽度下定稿后未随容器变宽重排。三路证据：
  // 1) inner ResizeObserver：主区宽度逐帧变化（面板开合过渡窗口）。
  // 2) 每次流式发布：最后一个 <p>（markdown 真实标签）的祖先链逐层宽度——
  //    哪层被压窄一目了然；全宽但断行仍在 → 文本行缓存未重排。
  // 3) localStorage A/B 开关 novel-diag-no-cv=1：强制 .enter content-visibility
  //    visible（inline 覆盖），同会话对比验证 containment 嫌疑。
  useEffect(() => {
    const inner = innerRef.current;
    if (inner === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      debugLog(`[timeline-diag] inner resize w=${width} t=${Math.round(performance.now())}`);
    });
    observer.observe(inner);
    return () => observer.disconnect();
    // 仅依赖 conversationId：切换会话时重新挂载观察
  }, [conversationId]);

  useEffect(() => {
    logWrapDiag("mount");
    // 仅依赖 conversationId：切换会话时记录一次基线宽度链
  }, [conversationId]);

  function logWrapDiag(label: string): void {
    const inner = innerRef.current;
    if (inner === null) return;
    applyNoContentVisibilityOverride(inner);
    const paragraphs = inner.querySelectorAll("p");
    const last = paragraphs[paragraphs.length - 1];
    const chain: string[] = [`inner w=${Math.round(inner.getBoundingClientRect().width)}`];
    let node: Element | null = last ?? null;
    while (node !== null && node !== inner) {
      const rect = node.getBoundingClientRect();
      chain.push(`${node.tagName.toLowerCase()} w=${Math.round(rect.width)}`);
      node = node.parentElement;
    }
    debugLog(
      `[timeline-diag] ${label} t=${Math.round(performance.now())} p=${paragraphs.length}` +
        ` head=${last?.textContent?.slice(0, 10) ?? "-"}`,
      chain.join(" <- "),
    );
  }

  function applyNoContentVisibilityOverride(inner: HTMLElement): void {
    try {
      if (window.localStorage.getItem("novel-diag-no-cv") !== "1") return;
    } catch {
      return;
    }
    for (const child of inner.children) {
      (child as HTMLElement).style.contentVisibility = "visible";
    }
  }
  // ============ TEMP-DIAG 结束 ============

  return (
    <div
      className={styles.timeline}
      ref={scrollRef}
      role="log"
      aria-label="对话时间线"
      onScroll={(event) => {
        // 仅 ref 记忆贴底状态（零 setState：滚动路径不产生重渲染）
        const node = event.currentTarget;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      <div className={styles.inner} key={conversationId} ref={innerRef}>
        {items.map((item, index) => {
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
                onOpenApproval,
                onNotify,
                firstUserSequence,
                onCardAction: handleCardAction,
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RenderItemDeps {
  readonly conversationId: string;
  readonly onMessageReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  /** 消息内操作提示（如复制结果）；上行到 shell ToastHost。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
  /** 时间线中首条用户消息的 sequence（决定复制按钮 inPad 态）。 */
  readonly firstUserSequence?: number;
  /** 卡片动作回调（useCallback 稳定引用）。 */
  readonly onCardAction: (cardId: string, action: string, payload?: unknown) => void;
}

function renderItem(item: TimelineItem, deps: RenderItemDeps): ReactNode {
  const {
    onMessageReferenceClick,
    resolveReference,
    onOpenApproval,
    onNotify,
    firstUserSequence,
    onCardAction,
  } = deps;
  switch (item.kind) {
    case "run":
      return (
        <div className={styles.runSep}>
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
          revision={item.revision}
          failureDetail={item.failureDetail}
          text={item.text}
          cards={item.cards}
          streaming={item.streaming}
          segments={item.segments}
          onResolveReference={resolveReference}
          onNotify={onNotify}
          onCardAction={onCardAction}
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
    case "design":
      return (
        <DesignCard
          conversationId={item.design.conversationId}
          phase={item.design.phase}
        />
      );
  }
}
