/**
 * ManuscriptChapterContent
 *
 * 章阅读区（MS-2~5，demo chapterHTML）：
 *   章头 = 衬线 18px 章名 + 实现 chip（仅 撰写中/已完成 两态）+ mono 元信息行
 *   「卷名 · N 字 ·（含草稿）」（更新时间暂无数据源，省略）；
 *   受阻章 = warn 横幅 + 楷体空态；弃置章 = faint 横幅；未开笔 = 楷体空态；
 *   段落与草稿块见 ManuscriptBlock（MS-3/4）。
 * 草稿章底部保留「前往审批 →」入口；文末保留「新增段落」细链接（降噪写路径）。
 *
 * 定位（locate）：来自对话引用的章节/段落滚动到可视区并闪烁高亮。
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, ArrowRight, Plus, X } from "lucide-react";
import { Button, Icon, StatusChip } from "../../../../shared/primitives/index.js";
import { REAL_STATUS, type RealizationView } from "../../outline/outlineStatus.js";
import type { ManuscriptChapter } from "../store/ManuscriptStructureStore.js";
import type { MessageReference } from "../../../conversation/components/MessageReference.js";
import type { ReferenceResolver } from "../../../conversation/reference/ReferenceResolver.js";
import { ManuscriptBlock } from "./ManuscriptBlock.js";
import styles from "./ManuscriptChapterContent.module.css";

/** 大纲树派生的章状态（ContentSurface 注入） */
export interface ManuscriptChapterStatus {
  readonly realization: RealizationView | undefined;
  readonly blockedReason: string | undefined;
  readonly abandonedReason: string | undefined;
}

export interface ManuscriptChapterContentProps {
  readonly chapter: ManuscriptChapter | undefined;
  readonly volumeTitle?: string;
  readonly realization?: RealizationView;
  readonly blockedReason?: string;
  readonly abandonedReason?: string;
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
  /** 新增段落（文末细链接） */
  readonly onInsertParagraph?: () => void;
  /** 保存段落编辑（宿主带乐观锁） */
  readonly onSaveParagraph?: (paragraphId: string, text: string) => Promise<void> | void;
  /** 删除段落（宿主确认后执行） */
  readonly onDeleteParagraph?: (paragraphId: string) => void;
}

export function ManuscriptChapterContent({
  chapter,
  volumeTitle,
  realization,
  blockedReason,
  abandonedReason,
  locate,
  onOpenDraft,
  onReferenceClick,
  resolveReference,
  onInsertParagraph,
  onSaveParagraph,
  onDeleteParagraph,
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
      target.classList.add(styles.flash!);
      const timer = window.setTimeout(() => {
        target.classList.remove(styles.flash!);
      }, 2600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [chapter?.chapterId, locate]);

  if (chapter === undefined) {
    return <div className={styles.placeholder}>请选择章节</div>;
  }
  const draftChangeSetId = chapter.isDraft === true ? chapter.changeSetId : undefined;
  const words = chapter.blocks.reduce(
    (sum, block) => sum + (block.textLength ?? block.text.length),
    0,
  );
  const hasDraft =
    chapter.isDraft === true || chapter.blocks.some((block) => block.isDraft === true);
  // MS-2：章头 chip 仅 撰写中/已完成 两态。
  const chip = realization === "in-progress" || realization === "completed"
    ? REAL_STATUS[realization]
    : undefined;
  const meta = [
    volumeTitle,
    words > 0 ? `${words.toLocaleString()} 字` : undefined,
    hasDraft ? "含草稿" : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
  const blocked = realization === "blocked";
  const abandoned = realization === "abandoned";
  const writable = !blocked && !abandoned;

  return (
    <div className={styles.content} ref={paneRef} data-chapter-id={chapter.chapterId}>
      <div className={styles.column}>
        <header className={styles.head}>
          <h2 className={styles.title}>{chapter.title}</h2>
          {chip !== undefined ? (
            <StatusChip variant={chip.variant} title={realization}>
              {chip.label}
            </StatusChip>
          ) : null}
        </header>
        {meta !== "" ? <div className={styles.meta}>{meta}</div> : null}
        <div className={styles.blocks}>
          {blocked ? (
            <>
              <div className={`${styles.banner} ${styles.warn}`}>
                <Icon icon={AlertTriangle} size="sm" />
                <span>本章受阻：{blockedReason ?? "依赖未定"}</span>
              </div>
              <div className={styles.emptyKai}>
                <span className={styles.glyph} aria-hidden="true">❦</span>
                等上游定稿，这一章就能落笔。
              </div>
            </>
          ) : abandoned ? (
            <div className={`${styles.banner} ${styles.faint}`}>
              <Icon icon={X} size="sm" />
              <span>本单元已弃置：{abandonedReason ?? "已从主线移除"}</span>
            </div>
          ) : chapter.blocks.length === 0 ? (
            <div className={styles.emptyKai}>
              <span className={styles.glyph} aria-hidden="true">❦</span>
              此章尚未落笔——从一句话开始，让故事自己生长。
            </div>
          ) : (
            chapter.blocks.map((block) => (
              <ManuscriptBlock
                key={block.blockId}
                block={block}
                onReferenceClick={onReferenceClick}
                resolveReference={resolveReference}
                onSave={
                  onSaveParagraph !== undefined
                    ? (text) => onSaveParagraph(block.blockId, text)
                    : undefined
                }
                onDelete={
                  onDeleteParagraph !== undefined
                    ? () => onDeleteParagraph(block.blockId)
                    : undefined
                }
              />
            ))
          )}
          {writable && onInsertParagraph !== undefined ? (
            <div className={styles.insertActions}>
              <Button
                size="sm"
                variant="link"
                leadingIcon={<Icon icon={Plus} size="xs" />}
                onClick={onInsertParagraph}
              >
                新增段落
              </Button>
            </div>
          ) : null}
        </div>
        {draftChangeSetId !== undefined && onOpenDraft !== undefined ? (
          <footer className={styles.draftActions}>
            <Button
              size="sm"
              variant="link"
              trailingIcon={<Icon icon={ArrowRight} size="sm" />}
              onClick={() => onOpenDraft(draftChangeSetId)}
            >
              前往审批
            </Button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
