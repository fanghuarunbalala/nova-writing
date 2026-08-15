/**
 * ManuscriptDirectory
 *
 * 正文目录（PRD SB-8）：dirHead「卷 · 章」由 Sidebar 提供；卷分组（可折叠，
 * chevron + 章数）→ 章行（状态圆点 + 草稿标记「草」）。章状态从关联 story unit
 * 的实现态派生（无关联 = neutral）。点击章 = manuscript.selectChapter。
 */
import { memo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ManuscriptStructureSnapshot } from "../../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import styles from "./directory.module.css";

export interface ManuscriptDirectoryProps {
  readonly snapshot: ManuscriptStructureSnapshot;
  readonly onSelectChapter: (chapterId: string) => void;
  /** 章状态解析（storyUnitId → 实现态；宿主用大纲树派生） */
  readonly resolveChapterState?: (chapterId: string) => string | undefined;
}

export const ManuscriptDirectory = memo(function ManuscriptDirectory({
  snapshot,
  onSelectChapter,
  resolveChapterState,
}: ManuscriptDirectoryProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (snapshot.volumes.length === 0) {
    return <div className={styles.empty}>此作品尚未建立正文结构</div>;
  }
  return (
    <div className={styles.directory}>
      {snapshot.volumes.map((volume) => {
        const open = !collapsed.has(volume.volumeId);
        return (
          <div key={volume.volumeId}>
            <button
              type="button"
              className={styles.groupHead}
              data-open={open}
              aria-expanded={open}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(volume.volumeId)) next.delete(volume.volumeId);
                  else next.add(volume.volumeId);
                  return next;
                })
              }
            >
              <span className={styles.chev}>
                <Icon icon={ChevronDown} size="xs" />
              </span>
              {volume.title}
              <span className={styles.count}>{volume.chapters.length}</span>
            </button>
            {open
              ? volume.chapters.map((chapter) => (
                  <button
                    key={chapter.chapterId}
                    type="button"
                    className={styles.row}
                    data-active={
                      chapter.chapterId === snapshot.selectedChapterId || undefined
                    }
                    style={{ paddingLeft: "var(--space-6)" }}
                    onClick={() => onSelectChapter(chapter.chapterId)}
                  >
                    <span
                      className={styles.statusDot}
                      data-state={resolveChapterState?.(chapter.chapterId)}
                      aria-hidden="true"
                    />
                    <span className={styles.text}>
                      <span className={styles.title}>{chapter.title}</span>
                    </span>
                    {chapter.isDraft ? (
                      <span className={styles.count} aria-label="含草稿">
                        草
                      </span>
                    ) : null}
                  </button>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
});
