/**
 * ManuscriptBlock
 *
 * 单个正文块（原型 .block + .b-head + .b-id + .b-dg + .b-draft + p）。
 *
 * 块用 dashed border-top 分隔（首块无边框）；b-head mono/faint；
 * b-draft warn 色；p 14.5px/1.85/fg/text-wrap:pretty。
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
    <button
      type="button"
      className={styles.block}
      onClick={onSelect}
      data-block-id={block.blockId}
    >
      <div className={styles.head}>
        <span className={styles.id}>{block.blockId}</span>
        {block.isDraft === true ? <span className={styles.draft}>草稿</span> : null}
        <span className={styles.digest}>{block.digest}</span>
      </div>
      {block.text !== "" ? <p className={styles.text}>{block.text}</p> : null}
    </button>
  );
}
