/**
 * ProposalOp
 *
 * 单条变更操作行（原型 .op）：mark 符号（+/~/−/→/○）+ 描述 + 类型。
 * mark 用 mono 字体 + 颜色区分（无背景胶囊），与原型 .op-mark 一致。
 */
import type { ProposalOpData } from "../projection/ConversationCardDescriptor.js";
import { RichTextRenderer } from "../cards/RichTextRenderer.js";
import styles from "./ProposalOp.module.css";

const MARK_SYMBOL: Record<ProposalOpData["mark"], string> = {
  add: "+",
  mod: "~",
  del: "−",
  move: "→",
  plan: "○",
};

const KIND_LABEL: Record<ProposalOpData["kind"], string> = {
  manuscript: "正文",
  outline: "大纲",
  character: "角色",
  location: "地点",
  todo: "待办",
  plan: "计划",
  scope: "范围",
};

export interface ProposalOpProps {
  readonly op: ProposalOpData;
}

export function ProposalOp({ op }: ProposalOpProps) {
  return (
    <li className={[styles.op, styles[op.mark]].filter(Boolean).join(" ")}>
      <span className={styles.mark} aria-hidden="true">{MARK_SYMBOL[op.mark]}</span>
      <span className={styles.text}>
        <RichTextRenderer richText={op.description} />
      </span>
      <span className={styles.kind}>{KIND_LABEL[op.kind]}</span>
    </li>
  );
}
