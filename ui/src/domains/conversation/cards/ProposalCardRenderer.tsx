/**
 * ProposalCardRenderer
 *
 * proposal 卡片：tag/标题/meta + 变更操作列表 + 前往审批 Diff。
 * op mark 用符号（+/~/−/->/○）对齐原型 .op-mark；kind 用中文标签。
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

const OP_MARK_SYMBOL: Record<ProposalOpData["mark"], string> = {
  add: "+",
  mod: "~",
  del: "−",
  move: "->",
  plan: "○",
};

const OP_KIND_LABEL: Record<ProposalOpData["kind"], string> = {
  manuscript: "正文",
  outline: "大纲",
  character: "角色",
  location: "地点",
  todo: "待办",
  plan: "计划",
  scope: "范围",
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
          <li key={op.id} className={[styles.op, styles[op.mark]].filter(Boolean).join(" ")}>
            <span className={styles.opMark} aria-hidden="true">{OP_MARK_SYMBOL[op.mark]}</span>
            <span className={styles.opText}>
              <RichTextRenderer
                richText={op.description}
                onReference={(reference) => onAction?.("reference", reference)}
              />
            </span>
            <span className={styles.opKind}>{OP_KIND_LABEL[op.kind]}</span>
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
