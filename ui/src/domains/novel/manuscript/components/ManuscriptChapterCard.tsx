/**
 * ManuscriptChapterCard
 *
 * 章节卡片（原型 .chapter-card）：header（h4 + 可选 draft-tag + 可选 rev）
 * + block 列表。
 *
 * header baseline 对齐；rev 用 mono/faint；draft 章节额外加 draft-tag。
 */
import { useEffect, useRef } from "react";
import type { ManuscriptChapter } from "../store/ManuscriptStructureStore.js";
import { ManuscriptBlock } from "./ManuscriptBlock.js";
import { ManuscriptDraftTag } from "./ManuscriptDraftTag.js";
import styles from "./ManuscriptChapterCard.module.css";

export interface ManuscriptChapterCardProps {
  readonly chapter: ManuscriptChapter;
  readonly isDraft?: boolean;
  readonly locate?: { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number };
  readonly onSelectBlock?: (blockId: string) => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}

export function ManuscriptChapterCard({
  chapter,
  isDraft = false,
  locate,
  onSelectBlock,
}: ManuscriptChapterCardProps) {
  const cardRef = useRef<HTMLElement>(null);

  // 定位：来自对话引用的章节/段落，滚动到可视区并闪烁高亮。
  useEffect(() => {
    if (locate === undefined) return;
    const target =
      locate.kind === "chapter" && locate.id === chapter.chapterId
        ? cardRef.current
        : locate.kind === "paragraph"
          ? cardRef.current?.querySelector(`[data-block-id="${locate.id}"]`)
          : null;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.add(styles.flash);
      const timer = window.setTimeout(() => {
        target.classList.remove(styles.flash);
      }, 2600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [chapter.chapterId, locate]);

  return (
    <section className={styles.card} ref={cardRef} data-chapter-id={chapter.chapterId}>
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
