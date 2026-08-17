/**
 * ManuscriptReader
 *
 * 正文阅读区（MS-1：卷章目录在内容视图左栏 ManuScriptDirectory，主区为
 * 选中章的阅读区）。未选章时回退首章；空/加载/失败态给出引导。
 *
 * 章头元信息与状态派生（卷名 / 实现态 / 受阻·弃置原因）由宿主经
 * volumeTitleOf / chapterStatusOf 注入（数据来自大纲树快照）。
 */
import type { ManuscriptStructureSnapshot } from "../store/ManuscriptStructureStore.js";
import { ManuscriptChapterContent } from "./ManuscriptChapterContent.js";
import type { ManuscriptChapterStatus } from "./ManuscriptChapterContent.js";
import type { MessageReference } from "../../../conversation/components/MessageReference.js";
import type { ReferenceResolver } from "../../../conversation/reference/ReferenceResolver.js";
import styles from "./ManuscriptReader.module.css";

export interface ManuscriptReaderProps {
  readonly workspaceId: string;
  readonly snapshot: ManuscriptStructureSnapshot;
  /** chapterId → 卷名（章头元信息行） */
  readonly volumeTitleOf?: (chapterId: string) => string | undefined;
  /** chapterId → 大纲派生章状态（章头 chip / 受阻·弃置横幅） */
  readonly chapterStatusOf?: (chapterId: string) => ManuscriptChapterStatus | undefined;
  readonly locate?: {
    readonly kind: "chapter" | "paragraph";
    readonly id: string;
    readonly nonce: number;
  } | null;
  readonly onOpenDraft?: (changeSetId: string) => void;
  /** 实体引用 chip 点击（宿主路由） */
  readonly onReferenceClick?: (reference: MessageReference) => void;
  /** 引用解析（chip 显示名 / missing 态） */
  readonly resolveReference?: ReferenceResolver;
  /** 新增段落（宿主按章选择末位追加） */
  readonly onInsertParagraph?: (chapterId: string) => void;
  /** 保存段落编辑（宿主带乐观锁） */
  readonly onSaveParagraph?: (paragraphId: string, text: string) => Promise<void> | void;
  /** 删除段落（宿主确认后执行） */
  readonly onDeleteParagraph?: (paragraphId: string) => void;
}

export function ManuscriptReader({
  workspaceId,
  snapshot,
  volumeTitleOf,
  chapterStatusOf,
  locate,
  onOpenDraft,
  onReferenceClick,
  resolveReference,
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
  const selectedChapter =
    snapshot.chapters.find((chapter) => chapter.chapterId === snapshot.selectedChapterId) ??
    snapshot.chapters[0];
  if (selectedChapter === undefined) {
    return <div className={styles.empty}>请选择章节</div>;
  }
  const status = chapterStatusOf?.(selectedChapter.chapterId);
  return (
    <div className={styles.reader} data-workspace={workspaceId}>
      <ManuscriptChapterContent
        chapter={selectedChapter}
        volumeTitle={volumeTitleOf?.(selectedChapter.chapterId)}
        realization={status?.realization}
        blockedReason={status?.blockedReason}
        abandonedReason={status?.abandonedReason}
        locate={locate}
        onOpenDraft={onOpenDraft}
        onReferenceClick={onReferenceClick}
        resolveReference={resolveReference}
        onInsertParagraph={
          onInsertParagraph !== undefined
            ? () => onInsertParagraph(selectedChapter.chapterId)
            : undefined
        }
        onSaveParagraph={onSaveParagraph}
        onDeleteParagraph={onDeleteParagraph}
      />
    </div>
  );
}
