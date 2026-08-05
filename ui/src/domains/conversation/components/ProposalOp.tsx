/**
 * ProposalOp
 *
 * 单条变更操作行：mark 徽标 + 描述 + 类型。
 */
import type { ProposalOpData } from "../projection/ConversationCardDescriptor.js";
import { RichTextRenderer } from "../cards/RichTextRenderer.js";
import styles from "./ProposalOp.module.css";

const MARK_LABEL: Record<ProposalOpData["mark"], string> = {
  add: "新增",
  mod: "修改",
  del: "删除",
  move: "移动",
  plan: "计划",
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
    <li className={styles.op}>
      <span className={[styles.mark, styles[op.mark]].filter(Boolean).join(" ")}>
        {MARK_LABEL[op.mark]}
      </span>
      <span className={styles.text}>
        <RichTextRenderer richText={op.description} />
      </span>
      <span className={styles.kind}>{KIND_LABEL[op.kind]}</span>
    </li>
  );
}
