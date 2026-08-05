/**
 * ManuscriptDraftTag
 *
 * 草稿版本标记。
 */
import styles from "./ManuscriptDraftTag.module.css";

export interface ManuscriptDraftTagProps {
  readonly revision: string;
}

export function ManuscriptDraftTag({ revision }: ManuscriptDraftTagProps) {
  return <span className={styles.tag}>{revision}</span>;
}
