/**
 * ManuscriptToc
 *
 * 正文目录左栏：按 卷（Volume）→ 章（Chapter）两级列出章节，
 * 点击章按钮回调 onSelectChapter。
 */
import type { ManuscriptVolume } from "../store/ManuscriptStructureStore.js";
import styles from "./ManuscriptToc.module.css";

export interface ManuscriptTocProps {
  readonly volumes: readonly ManuscriptVolume[];
  readonly selectedChapterId: string | undefined;
  readonly onSelectChapter: (chapterId: string) => void;
}

export function ManuscriptToc({
  volumes,
  selectedChapterId,
  onSelectChapter,
}: ManuscriptTocProps) {
  return (
    <nav className={styles.toc} aria-label="章节目录">
      {volumes.map((volume) => (
        <div key={volume.volumeId} className={styles.volume}>
          <h3 className={styles.volumeTitle}>{volume.title}</h3>
          {volume.chapters.map((chapter) => {
            const active = chapter.chapterId === selectedChapterId;
            return (
              <button
                key={chapter.chapterId}
                type="button"
                className={active ? `${styles.chapter} ${styles.active}` : styles.chapter}
                data-chapter-id={chapter.chapterId}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectChapter(chapter.chapterId)}
              >
                {chapter.title}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
