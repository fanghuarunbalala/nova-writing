/**
 * ManuscriptChapterCard
 *
 * 章节卡片（原型 .chapter-card）：header（h4 + 可选 draft-tag + 可选 rev）
 * + block 列表。
 *
 * header baseline 对齐；rev 用 mono/faint；draft 章节额外加 draft-tag。
 */
import type { ManuscriptChapter } from "../store/ManuscriptStructureStore.js";
import { ManuscriptBlock } from "./ManuscriptBlock.js";
import { ManuscriptDraftTag } from "./ManuscriptDraftTag.js";
import styles from "./ManuscriptChapterCard.module.css";

export interface ManuscriptChapterCardProps {
  readonly chapter: ManuscriptChapter;
  readonly isDraft?: boolean;
  readonly onSelectBlock?: (blockId: string) => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}

export function ManuscriptChapterCard({
  chapter,
  isDraft = false,
  onSelectBlock,
}: ManuscriptChapterCardProps) {
  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <h4 className={styles.title}>{chapter.title}</h4>
        {isDraft ? <ManuscriptDraftTag /> : null}
        {chapter.revision !== undefined ? <span className={styles.rev}>{chapter.revision}</span> : null}
      </header>
      <div className={styles.blocks}>
        {chapter.blocks.map((block) => (
          <ManuscriptBlock
            key={block.blockId}
            block={block}
            onSelect={() => onSelectBlock?.(block.blockId)}
          />
        ))}
      </div>
    </section>
  );
}
