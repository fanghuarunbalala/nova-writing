/**
 * ManuscriptDraftTag
 *
 * 草稿标记（原型 .draft-tag）：warn-bg 底 + warn 色 + "草稿" 文本。
 *
 * 用于 draft 章节头部，与 .rev（mono 修订号）并列。
 */
import styles from "./ManuscriptDraftTag.module.css";

export interface ManuscriptDraftTagProps {
  readonly label?: string;
}

export function ManuscriptDraftTag({ label = "草稿" }: ManuscriptDraftTagProps) {
  return <span className={styles.tag}>{label}</span>;
}
