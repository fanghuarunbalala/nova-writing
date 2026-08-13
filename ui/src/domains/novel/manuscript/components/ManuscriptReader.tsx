/**
 * ManuscriptReader
 *
 * 正文阅读器（原型 .reader 双栏）：左侧 ManuscriptToc 按 卷 → 章 列出目录，
 * 右侧 ManuscriptChapterContent 展示选中章节的正文（保留行分割）。
 *
 * 空/加载/失败态：无卷章结构时给出空态引导；失败态复用 store 的错误文案。
 */
import type { ManuscriptStructureSnapshot } from "../store/ManuscriptStructureStore.js";
import { ManuscriptChapterContent } from "./ManuscriptChapterContent.js";
import { ManuscriptToc } from "./ManuscriptToc.js";
import styles from "./ManuscriptReader.module.css";

export interface ManuscriptReaderProps {
  readonly workspaceId: string;
  readonly snapshot: ManuscriptStructureSnapshot;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly locate?: {
    readonly kind: "chapter" | "paragraph";
    readonly id: string;
    readonly nonce: number;
  } | null;
  readonly onOpenDraft?: (changeSetId: string) => void;
  /** 新增段落（宿主按章 storyUnitId 插入） */
  readonly onInsertParagraph?: (storyUnitId: string) => void;
  /** 保存段落编辑（宿主带乐观锁） */
  readonly onSaveParagraph?: (paragraphId: string, text: string) => Promise<void> | void;
  /** 删除段落（宿主确认后执行） */
  readonly onDeleteParagraph?: (paragraphId: string) => void;
}

export function ManuscriptReader({
  workspaceId,
  snapshot,
  onSelectChapter,
  locate,
  onOpenDraft,
  onInsertParagraph,
  onSaveParagraph,
  onDeleteParagraph,
}: ManuscriptReaderProps) {
  if (snapshot.phase === "error") {
    return (
      <div className={styles.empty}>
        {snapshot.error?.message ?? "正文加载失败，请重试"}
      </div>
    );
  }
  if (snapshot.phase === "loading" && snapshot.chapters.length === 0) {
    return <div className={styles.empty}>正文加载中…</div>;
  }
  if (snapshot.chapters.length === 0) {
    return <div className={styles.empty}>暂无卷章结构，请先在写作工具中创建卷章</div>;
  }
  const selectedChapter = snapshot.chapters.find(
    (chapter) => chapter.chapterId === snapshot.selectedChapterId,
  );
  return (
    <div className={styles.reader} data-workspace={workspaceId}>
      <ManuscriptToc
        volumes={snapshot.volumes}
        selectedChapterId={snapshot.selectedChapterId}
        onSelectChapter={onSelectChapter}
      />
      <ManuscriptChapterContent
        chapter={selectedChapter}
        locate={locate}
        onOpenDraft={onOpenDraft}
        onInsertParagraph={
          onInsertParagraph !== undefined && selectedChapter?.storyUnitId !== undefined
            ? () => onInsertParagraph(selectedChapter!.storyUnitId!)
            : undefined
        }
        onSaveParagraph={onSaveParagraph}
        onDeleteParagraph={onDeleteParagraph}
      />
    </div>
  );
}
