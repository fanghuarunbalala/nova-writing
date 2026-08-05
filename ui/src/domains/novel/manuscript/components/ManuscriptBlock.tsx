/**
 * ManuscriptBlock
 *
 * 单个正文块：块 id + 摘要 + 文本预览。
 */
import type { ManuscriptBlockData } from "../store/ManuscriptStructureStore.js";
import styles from "./ManuscriptBlock.module.css";

export interface ManuscriptBlockProps {
  readonly block: ManuscriptBlockData;
  readonly onSelect?: () => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}

export function ManuscriptBlock({ block, onSelect }: ManuscriptBlockProps) {
  return (
    <button type="button" className={styles.block} onClick={onSelect}>
      <span className={styles.head}>
        <span className={styles.id}>{block.blockId}</span>
        <span className={styles.digest}>{block.digest}</span>
        {block.isDraft === true ? <span className={styles.draft}>草稿</span> : null}
      </span>
      {block.text !== "" ? <span className={styles.text}>{block.text}</span> : null}
    </button>
  );
}
