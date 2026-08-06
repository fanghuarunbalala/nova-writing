/**
 * AssistantMessage
 *
 * 助手消息：agent 头像 + 思考块（ThinkBlock）+ 正文 + 结构化卡片。
 * 卡片通过 ConversationCardRendererRegistry 渲染。
 */
import { Avatar } from "../../../shared/primitives/Avatar.js";
import { createDefaultConversationCardRendererRegistry } from "../cards/defaultRenderers.js";
import type { ConversationCardRendererRegistry } from "../cards/ConversationCardRendererRegistry.js";
import type {
  ConversationCardDescriptor,
} from "../projection/ConversationCardDescriptor.js";
import type { ThinkLineData } from "../projection/ConversationTimelineItem.js";
import { AssistantMarkdown } from "./assistantContent/AssistantMarkdown.js";
import type { MessageReference } from "./MessageReference.js";
import { ThinkBlock } from "./ThinkBlock.js";
import styles from "./AssistantMessage.module.css";

export type AssistantApprovalState = "generating" | "completed" | "submitted" | "failed";

export interface AssistantMessageProps {
  readonly sequence: number;
  readonly agentLabel: string;
  readonly timestamp: number;
  readonly approvalState?: AssistantApprovalState;
  readonly revision?: string;
  readonly thinkLines?: readonly ThinkLineData[];
  readonly text: string;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly streaming?: boolean;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onCardAction?: (cardId: string, action: string, payload?: unknown) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AssistantMessage({
  sequence,
  agentLabel,
  timestamp,
  approvalState,
  revision,
  thinkLines = [],
  text,
  cards = [],
  streaming = false,
  onReferenceClick,
  cardRenderers = createDefaultConversationCardRendererRegistry(),
  onCardAction,
}: AssistantMessageProps) {
  return (
    <div className={styles.message} data-sequence={sequence}>
      <Avatar variant="agent" text={agentLabel.slice(0, 2)} size="md" />
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.who}>{agentLabel}</span>
          <time className={styles.time}>{formatTime(timestamp)}</time>
          {revision !== undefined ? <span className={styles.revision}>{revision}</span> : null}
          {approvalState !== undefined ? (
            <span className={[styles.state, styles[approvalState]].filter(Boolean).join(" ")}>
              {approvalState}
            </span>
          ) : null}
        </div>
        {thinkLines.length > 0 ? <ThinkBlock lines={thinkLines} expanded={streaming} streaming={streaming} onToggle={() => undefined} /> : null}
        <div className={styles.text}>
          <AssistantMarkdown text={text} onReferenceClick={onReferenceClick} />
        </div>
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
