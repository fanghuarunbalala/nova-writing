/**
 * ConversationTimeline
 *
 * 按 mapper 输出追加序渲染时间线（chatSurfaceMapper 保证序不变量，不重排）；
 * 新消息到达自动滚到底（用户上滚除外）。
 * 虚拟化走 CSS content-visibility（gui-performance-2 功能点六）：视口外行
 * 跳过 layout/paint，滚动位置由 contain-intrinsic-size 估高支撑——无固定行高
 * 失真、无窗口重挂载闪烁；滚动路径零 setState（仅 ref 记忆贴底状态）。
 */
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { AskQuestionAnswer } from "@novel/core";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import type { ReferenceResolver } from "../reference/ReferenceResolver.js";
import type { ConversationTimelineItem as TimelineItem } from "../projection/ConversationTimelineItem.js";
import type { MessageReference } from "./MessageReference.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { DesignCard } from "./DesignCard.js";
import { QueuedUserMessage } from "./QueuedUserMessage.js";
import { UserMessage } from "./UserMessage.js";
import { AskQuestionCard } from "../../asking/components/AskQuestionCard.js";
import { AskRecordCard } from "../../asking/components/AskRecordCard.js";
import styles from "./ConversationTimeline.module.css";

/** 非挂载会话时的初始集合占位（全量入场，见 initialRef 注释）。 */
const EMPTY_SEQUENCES: ReadonlySet<number> = new Set();

export interface ConversationTimelineProps {
  readonly conversationId: string;
  readonly items: readonly TimelineItem[];
  readonly streamingSequence?: number;
  /** 底部预留（px，悬浮 composer 实际高度 + 间距）；缺省回落 CSS 132px。
   *  composer 状态行展开/输入增高时由 shell 实测回填，末条消息才能完整滚到输入框上方。 */
  readonly bottomReserve?: number;
  readonly onMessageReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly onProposalAction?: (changeSetId: string, action: "approve" | "reject" | "view-diff") => void;
  readonly onOpenApproval?: (approvalRequestId: string) => void;
  /** 提问卡作答回传（AskUserQuestion 工具挂起等待解除） */
  readonly onResolveAsking?: (requestId: string, answers: readonly AskQuestionAnswer[]) => void;
  /** 提问卡跳过全部（逐问按 skipped 回传） */
  readonly onSkipAsking?: (requestId: string) => void;
  /** 消息内操作提示（如复制结果）；上行到 shell ToastHost。 */
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ConversationTimeline({
  conversationId,
  items,
  streamingSequence,
  bottomReserve,
  onMessageReferenceClick,
  resolveReference,
  onProposalAction,
  onOpenApproval,
  onResolveAsking,
  onSkipAsking,
  onNotify,
}: ConversationTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // 初始项（组件挂载时该会话已在列的 sequence）：视图切换重挂后整列重播
  // conv-in 级联是突兀源——初始项不入场（容器 .surface view-in 已承担整体淡入），
  // 仅后续追加项逐条入场。无类切换/定时器，不存在「摘抑制类→动画重播」问题。
  // 会话切换只重挂 .inner（组件实例保留）：sequence 跨会话可能撞号，集合绑定
  // 挂载时的 conversationId，切走后按空集处理 → 会话切换保留级联入场。
  const initialRef = useRef<{ readonly id: string; readonly set: ReadonlySet<number> } | null>(null);
  if (initialRef.current === null) {
    initialRef.current = {
      id: conversationId,
      set: new Set(items.map((item) => item.sequence)),
    };
  }
  const initialSequences =
    initialRef.current.id === conversationId ? initialRef.current.set : EMPTY_SEQUENCES;
  // 首条用户消息：复制按钮收进气泡内边距带（原型 .msg-actions-inpad）。
  const firstUserSequence = items.find((item) => item.kind === "user")?.sequence;
  // 流式正文增长（贴底跟随依据）：末项文本长度随发布递增；
  // 排队幽灵项恒在末尾且文本不变，跳过取其前首个真实项
  const lastItemTextLength = (() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]!;
      if (item.kind === "queued") continue;
      return "text" in item ? item.text.length : 0;
    }
    return 0;
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

  // 贴底跟随：新消息 / persist 序号 / 流式正文增长时滚到底（用户上滚除外）。
  // 追加一帧 rAF 二次贴底：兜住 content-visibility 估高（240px）落位后行高
  // 收缩、以及底部预留/composer 过渡期间的 scrollHeight 漂移
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null || !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
    const raf = requestAnimationFrame(() => {
      if (stickToBottom.current && scrollRef.current !== null) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [items.length, streamingSequence, lastItemTextLength, bottomReserve]);

  return (
    <div
      className={styles.timeline}
      ref={scrollRef}
      role="log"
      aria-label="对话时间线"
      style={
        bottomReserve !== undefined
          ? ({ "--timeline-bottom-reserve": `${bottomReserve}px` } as CSSProperties)
          : undefined
      }
      onScroll={(event) => {
        // 仅 ref 记忆贴底状态（零 setState：滚动路径不产生重渲染）
        const node = event.currentTarget;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      <div className={styles.inner} key={conversationId}>
        {items.map((item, index) => {
          const isInitial = initialSequences.has(item.sequence);
          return (
            <div
              key={item.sequence}
              className={isInitial ? styles.enterStatic : styles.enter}
              style={
                isInitial
                  ? undefined
                  : { animationDelay: `${Math.min(index * 0.03, 0.42)}s` }
              }
            >
              {renderItem(item, {
                conversationId,
                onMessageReferenceClick,
                resolveReference,
                onOpenApproval,
                onResolveAsking,
                onSkipAsking,
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
  readonly onResolveAsking?: (requestId: string, answers: readonly AskQuestionAnswer[]) => void;
  readonly onSkipAsking?: (requestId: string) => void;
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
    onResolveAsking,
    onSkipAsking,
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
    case "queued":
      return <QueuedUserMessage text={item.text} queuedAt={item.queuedAt} />;
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
    case "ask":
      return onResolveAsking !== undefined && onSkipAsking !== undefined ? (
        <AskQuestionCard
          asking={item.asking}
          onResolve={onResolveAsking}
          onSkip={onSkipAsking}
        />
      ) : (
        <AskQuestionCard asking={item.asking} onResolve={() => {}} onSkip={() => {}} />
      );
    case "askRecord":
      return (
        <AskRecordCard
          toolCallId={item.toolCallId}
          questions={item.questions}
          result={item.result}
        />
      );
  }
}
