/**
 * ProposalCardRenderer
 *
 * proposal 卡片：tag/标题/meta + 变更操作列表 + 前往审批 Diff。
 */
import { Button } from "../../../shared/primitives/Button.js";
import { Pill } from "../../../shared/primitives/Pill.js";
import type {
  ProposalCardContent,
  ProposalOpData,
} from "../projection/ConversationCardDescriptor.js";
import type { ConversationCardRenderer } from "./ConversationCardRendererRegistry.js";
import { RichTextRenderer } from "./RichTextRenderer.js";
import styles from "./ProposalCardRenderer.module.css";

const TAG_VARIANT: Record<ProposalCardContent["tag"], "info" | "pending" | "approved"> = {
  plan: "info",
  proposal: "pending",
  applied: "approved",
};

const OP_MARK_LABEL: Record<ProposalOpData["mark"], string> = {
  add: "新增",
  mod: "修改",
  del: "删除",
  move: "移动",
  plan: "计划",
};

export interface ProposalCardRendererProps {
  readonly card: { readonly kind: "proposal"; readonly id: string; readonly content: ProposalCardContent };
  readonly onAction?: (action: string, payload?: unknown) => void;
}

export function ProposalCardRenderer({ card, onAction }: ProposalCardRendererProps) {
  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <Pill variant={TAG_VARIANT[card.content.tag]}>{card.content.tag}</Pill>
        <h4 className={styles.title}>{card.content.title}</h4>
        {card.content.meta !== undefined ? (
          <span className={styles.meta}>{card.content.meta}</span>
        ) : null}
      </header>
      <ul className={styles.ops}>
        {card.content.ops.map((op) => (
          <li key={op.id} className={styles.op}>
            <span className={[styles.opMark, styles[op.mark]].filter(Boolean).join(" ")}>
              {OP_MARK_LABEL[op.mark]}
            </span>
            <span className={styles.opText}>
              <RichTextRenderer
                richText={op.description}
                onReference={(reference) => onAction?.("reference", reference)}
              />
            </span>
            <span className={styles.opKind}>{op.kind}</span>
          </li>
        ))}
      </ul>
      {card.content.changeSetId !== undefined ? (
        <footer className={styles.foot}>
          <Button
            size="sm"
            onClick={() => onAction?.("view-diff", card.content.changeSetId)}
          >
            前往审批 Diff
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

export const ProposalCardRendererObject: ConversationCardRenderer<{
  kind: "proposal";
  id: string;
  content: ProposalCardContent;
}> = {
  kind: "proposal",
  render: ({ card, onAction }) => <ProposalCardRenderer card={card} onAction={onAction} />,
};
