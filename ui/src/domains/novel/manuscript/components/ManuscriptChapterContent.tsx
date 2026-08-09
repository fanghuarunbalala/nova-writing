/**
 * ManuscriptChapterContent
 *
 * 正文阅读器右栏：选中章节的标题 + 正文块列表（行分割保留），
 * 草稿章节底部提供「前往审批 →」入口。
 *
 * 定位（locate）：来自对话引用的章节/段落滚动到可视区并闪烁高亮。
 */
import { useEffect, useRef } from "react";
import { Button } from "../../../../shared/primitives/Button.js";
import type { ManuscriptChapter } from "../store/ManuscriptStructureStore.js";
import { ManuscriptBlock } from "./ManuscriptBlock.js";
import { ManuscriptDraftTag } from "./ManuscriptDraftTag.js";
import styles from "./ManuscriptChapterContent.module.css";

export interface ManuscriptChapterContentProps {
  readonly chapter: ManuscriptChapter | undefined;
  readonly locate?: {
    readonly kind: "chapter" | "paragraph";
    readonly id: string;
    readonly nonce: number;
  } | null;
  readonly onOpenDraft?: (changeSetId: string) => void;
}

export function ManuscriptChapterContent({
  chapter,
  locate,
  onOpenDraft,
}: ManuscriptChapterContentProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (locate === undefined || locate === null) return;
    const target =
      locate.kind === "chapter" && locate.id === chapter?.chapterId
        ? paneRef.current
        : locate.kind === "paragraph"
          ? paneRef.current?.querySelector(`[data-block-id="${locate.id}"]`)
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
  }, [chapter?.chapterId, locate]);

  if (chapter === undefined) {
    return <div className={styles.placeholder}>请选择章节</div>;
  }
  const draftChangeSetId = chapter.isDraft === true ? chapter.changeSetId : undefined;

  return (
    <div className={styles.content} ref={paneRef} data-chapter-id={chapter.chapterId}>
      <header className={styles.head}>
        <h2 className={styles.title}>{chapter.title}</h2>
        {chapter.isDraft === true ? <ManuscriptDraftTag /> : null}
      </header>
      <div className={styles.blocks}>
        {chapter.blocks.map((block) => (
          <ManuscriptBlock key={block.blockId} block={block} />
        ))}
      </div>
      {draftChangeSetId !== undefined && onOpenDraft !== undefined ? (
        <footer className={styles.draftActions}>
          <Button size="sm" variant="link" onClick={() => onOpenDraft(draftChangeSetId)}>
            前往审批 →
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
