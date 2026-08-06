/**
 * DiffCardRenderer
 *
 * diff 卡片：变更集摘要 + 打开 Diff 详情。
 */
import { Button } from "../../../shared/primitives/Button.js";
import type { DiffCardContent } from "../projection/ConversationCardDescriptor.js";
import type { ConversationCardRenderer } from "./ConversationCardRendererRegistry.js";
import styles from "./DiffCardRenderer.module.css";

export interface DiffCardRendererProps {
  readonly card: { readonly kind: "diff"; readonly id: string; readonly content: DiffCardContent };
  readonly onAction?: (action: string, payload?: unknown) => void;
}

export function DiffCardRenderer({ card, onAction }: DiffCardRendererProps) {
  return (
    <section className={styles.card}>
      <span className={styles.summary}>{card.content.summary}</span>
      <Button
        size="sm"
        onClick={() => onAction?.("view-diff", card.content.changeSetId)}
      >
        查看 Diff
      </Button>
    </section>
  );
}

export const DiffCardRendererObject: ConversationCardRenderer<{
  kind: "diff";
  id: string;
  content: DiffCardContent;
}> = {
  kind: "diff",
  render: ({ card, onAction }) => <DiffCardRenderer card={card} onAction={onAction} />,
};
