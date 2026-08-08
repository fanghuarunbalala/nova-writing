/**
 * ManuscriptChapterList
 *
 * 章节列表容器。
 */
import type { ManuscriptChapter } from "../store/ManuscriptStructureStore.js";
import { ManuscriptChapterCard } from "./ManuscriptChapterCard.js";
import styles from "./ManuscriptChapterList.module.css";

export interface ManuscriptChapterListProps {
  readonly workspaceId: string;
  readonly chapters: readonly ManuscriptChapter[];
  readonly locate?: { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number };
  readonly onSelectBlock?: (blockId: string) => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}

export function ManuscriptChapterList({
  workspaceId,
  chapters,
  locate,
  onSelectBlock,
  onOpenDraft,
}: ManuscriptChapterListProps) {
  return (
    <div className={styles.list} data-workspace={workspaceId}>
      {chapters.map((chapter) => (
        <ManuscriptChapterCard
          key={chapter.chapterId}
          chapter={chapter}
          isDraft={chapter.isDraft}
          locate={locate}
          onSelectBlock={onSelectBlock}
          onOpenDraft={onOpenDraft}
        />
      ))}
    </div>
  );
}
