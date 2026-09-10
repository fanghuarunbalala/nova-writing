/**
 * PlanCardRenderer
 *
 * plan 卡片：todo/plan/scope 类操作列表。
 */
import type { PlanCardContent, ProposalOpData } from "../projection/ConversationCardDescriptor.js";
import type { ConversationCardRenderer } from "./ConversationCardRendererRegistry.js";
import { RichTextRenderer } from "./RichTextRenderer.js";
import styles from "./PlanCardRenderer.module.css";

const KIND_LABEL: Record<ProposalOpData["kind"], string> = {
  manuscript: "正文",
  outline: "大纲",
  character: "角色",
  location: "地点",
  todo: "待办",
  plan: "计划",
  scope: "范围",
};

export interface PlanCardRendererProps {
  readonly card: { readonly kind: "plan"; readonly id: string; readonly content: PlanCardContent };
  readonly onAction?: (action: string, payload?: unknown) => void;
}

export function PlanCardRenderer({ card, onAction }: PlanCardRendererProps) {
  return (
    <ol className={styles.plan}>
      {card.content.ops.map((op) => (
        <li key={op.id} className={styles.op}>
          <span className={styles.kind}>{KIND_LABEL[op.kind]}</span>
          <span className={styles.text}>
            <RichTextRenderer
              richText={op.description}
              onReference={(reference) => onAction?.("reference", reference)}
            />
          </span>
        </li>
      ))}
    </ol>
  );
}

export const PlanCardRendererObject: ConversationCardRenderer<{
  kind: "plan";
  id: string;
  content: PlanCardContent;
}> = {
  kind: "plan",
  render: ({ card, onAction }) => <PlanCardRenderer card={card} onAction={onAction} />,
};
