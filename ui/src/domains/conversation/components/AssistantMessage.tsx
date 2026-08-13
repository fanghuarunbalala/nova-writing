/**
 * AssistantMessage
 *
 * 助手消息（原型 .msg.assistant）：无头像，head 只保留 approval-state 状态
 * 标签；正文 + 思考指示（ThinkingIndicator，流式思考期间显示）+ 结构化卡片。
 * 卡片通过 ConversationCardRendererRegistry 渲染。
 */
import { createDefaultConversationCardRendererRegistry } from "../cards/defaultRenderers.js";
import type { ConversationCardRendererRegistry } from "../cards/ConversationCardRendererRegistry.js";
import type {
  ConversationCardDescriptor,
} from "../projection/ConversationCardDescriptor.js";
import type {
  ConversationEventView,
  ToolTraceView,
} from "../projection/ConversationTimelineItem.js";
import type { ReferenceResolver } from "../reference/ReferenceResolver.js";
import { AssistantMarkdown } from "./assistantContent/AssistantMarkdown.js";
import { RuntimeEventFlow } from "./RuntimeEventFlow.js";
import { ToolStrip } from "./ToolStrip.js";
import type { MessageReference } from "./MessageReference.js";
import { ThinkingIndicator } from "./ThinkingIndicator.js";
import styles from "./AssistantMessage.module.css";

export type AssistantApprovalState =
  | "generating"
  | "completed"
  | "submitted"
  | "failed"
  | "cancelled"
  | "rejected";

/** 消息头状态中文标签（原型 .approval-state）。 */
const APPROVAL_STATE_LABEL: Record<AssistantApprovalState, string> = {
  generating: "生成中",
  completed: "已完成",
  submitted: "已提交",
  failed: "生成失败",
  cancelled: "已停止",
  rejected: "已驳回",
};

export interface AssistantMessageProps {
  readonly sequence: number;
  /** 保留兼容调用方；v2 原型 head 只显示 approval-state，不再渲染。 */
  readonly agentLabel: string;
  /** 保留兼容调用方；v2 原型时间只在轮次分隔显示。 */
  readonly timestamp: number;
  readonly approvalState?: AssistantApprovalState;
  /** 保留兼容调用方；v2 原型 head 不再显示 revision。 */
  readonly revision?: string;
  readonly failureDetail?: string;
  readonly text: string;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly streaming?: boolean;
  /** 流式中当前是否正在产出思考（驱动 ThinkingIndicator）。 */
  readonly thinking?: boolean;
  readonly eventFlow?: readonly ConversationEventView[];
  readonly toolTraces?: readonly ToolTraceView[];
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly onResolveReference?: ReferenceResolver;
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onCardAction?: (cardId: string, action: string, payload?: unknown) => void;
}

export function AssistantMessage({
  sequence,
  approvalState,
  failureDetail,
  text,
  cards = [],
  streaming = false,
  thinking = false,
  eventFlow = [],
  toolTraces = [],
  onReferenceClick,
  onResolveReference,
  cardRenderers = createDefaultConversationCardRendererRegistry(),
  onCardAction,
}: AssistantMessageProps) {
  return (
    <div className={styles.message} data-sequence={sequence}>
      <div className={styles.body}>
        {approvalState !== undefined ? (
          <div className={styles.head}>
            <span className={[styles.state, styles[approvalState]].filter(Boolean).join(" ")}>
              {APPROVAL_STATE_LABEL[approvalState]}
            </span>
          </div>
        ) : null}
        {streaming && thinking ? <ThinkingIndicator /> : null}
        <div className={styles.text}>
          <AssistantMarkdown
            text={text}
            onReferenceClick={onReferenceClick}
            resolveReference={onResolveReference}
          />
        </div>
        {approvalState === "failed" && failureDetail !== undefined ? (
          <p className={styles.failureDetail}>{failureDetail}</p>
        ) : null}
        {eventFlow.length > 0 ? <RuntimeEventFlow events={eventFlow} /> : null}
        {toolTraces.length > 0 ? <ToolStrip traces={toolTraces} /> : null}
        {cards.length > 0 ? (
          <div className={styles.cards}>
            {cards.map((card) => {
              const renderer = cardRenderers.get(card.kind);
              if (renderer === undefined) return null;
              return (
                <div key={card.id} className={styles.card}>
                  {renderer.render({
                    card,
                    onAction: (action, payload) => onCardAction?.(card.id, action, payload),
                  })}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
