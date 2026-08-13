/**
 * ProposalBlock
 *
 * 计划/提案/已应用卡片：tag + 标题 + meta + 变更操作 + 底部动作。
 */
import type { ReactNode } from "react";
import { Pill } from "../../../shared/primitives/Pill.js";
import type { ProposalOpData } from "../projection/ConversationCardDescriptor.js";
import { ProposalOp } from "./ProposalOp.js";
import styles from "./ProposalBlock.module.css";

export type ProposalBlockTag = "plan" | "proposal" | "applied";

export interface ProposalBlockProps {
  readonly tag: ProposalBlockTag;
  readonly title: string;
  readonly meta?: string;
  readonly ops: readonly ProposalOpData[];
  readonly changeSetId?: string;
  readonly footActions?: ReactNode;
  readonly onViewDiff?: (changeSetId: string) => void;
}

const TAG_VARIANT: Record<ProposalBlockTag, "info" | "pending" | "approved"> = {
  plan: "info",
  proposal: "pending",
  applied: "approved",
};

export function ProposalBlock({
  tag,
  title,
  meta,
  ops,
  changeSetId,
  footActions,
  onViewDiff,
}: ProposalBlockProps) {
  return (
    <section className={styles.block}>
      <header className={styles.head}>
        <Pill variant={TAG_VARIANT[tag]}>{tag}</Pill>
        <h4 className={styles.title}>{title}</h4>
        {meta !== undefined ? <span className={styles.meta}>{meta}</span> : null}
      </header>
      <ul className={styles.ops}>
        {ops.map((op) => (
          <ProposalOp key={op.id} op={op} />
        ))}
      </ul>
      {changeSetId !== undefined || footActions !== undefined ? (
        <footer className={styles.foot}>
          {footActions}
          {changeSetId !== undefined ? (
            <button
              type="button"
              className={styles.diffButton}
              onClick={() => onViewDiff?.(changeSetId)}
            >
              前往审批 Diff
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
