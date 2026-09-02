/**
 * TextCardRenderer
 *
 * text 卡片：渲染富文本正文（surface 卡片容器 + 引用 chip 可点击跳转）。
 */
import type { TextCardContent } from "../projection/ConversationCardDescriptor.js";
import type { ConversationCardRenderer } from "./ConversationCardRendererRegistry.js";
import { RichTextRenderer } from "./RichTextRenderer.js";
import styles from "./TextCardRenderer.module.css";

export interface TextCardRendererProps {
  readonly card: { readonly kind: "text"; readonly id: string; readonly content: TextCardContent };
  readonly onAction?: (action: string, payload?: unknown) => void;
}

export function TextCardRendererComponent({ card, onAction }: TextCardRendererProps) {
  return (
    <div className={styles.card}>
      <RichTextRenderer
        richText={card.content.richText}
        onReference={(reference) => onAction?.("reference", reference)}
      />
    </div>
  );
}

export const TextCardRenderer: ConversationCardRenderer<{
  readonly kind: "text";
  readonly id: string;
  readonly content: TextCardContent;
}> = {
  kind: "text",
  render: ({ card, onAction }) => <TextCardRendererComponent card={card} onAction={onAction} />,
};
