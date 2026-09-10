/**
 * QuoteCardRenderer
 *
 * quote 卡片：引用块 + 出处。
 */
import type { QuoteCardContent } from "../projection/ConversationCardDescriptor.js";
import type { ConversationCardRenderer } from "./ConversationCardRendererRegistry.js";
import { RichTextRenderer } from "./RichTextRenderer.js";
import styles from "./QuoteCardRenderer.module.css";

export interface QuoteCardRendererProps {
  readonly card: { readonly kind: "quote"; readonly id: string; readonly content: QuoteCardContent };
  readonly onAction?: (action: string, payload?: unknown) => void;
}

export function QuoteCardRenderer({ card, onAction }: QuoteCardRendererProps) {
  return (
    <blockquote className={styles.quote}>
      <RichTextRenderer
        richText={card.content.text}
        onReference={(reference) => onAction?.("reference", reference)}
      />
      {card.content.attribution !== undefined ? (
        <cite className={styles.attribution}>—— {card.content.attribution}</cite>
      ) : null}
    </blockquote>
  );
}

export const QuoteCardRendererObject: ConversationCardRenderer<{
  kind: "quote";
  id: string;
  content: QuoteCardContent;
}> = {
  kind: "quote",
  render: ({ card, onAction }) => <QuoteCardRenderer card={card} onAction={onAction} />,
};
