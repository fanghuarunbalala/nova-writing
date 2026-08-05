/**
 * ManuscriptChapterCard
 *
 * 章节卡片：标题 + 块列表。
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
        {chapter.revision !== undefined ? <ManuscriptDraftTag revision={chapter.revision} /> : null}
        {isDraft ? <span className={styles.isDraft}>草稿版本</span> : null}
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
