/**
 * ManuscriptStructureStore
 *
 * 正文结构域 store：以权威 publication 结构（卷 → 章）为目录，
 * 段落目录（NovelParagraphCatalogSnapshot）为摘要来源，正文文本按需懒加载。
 *
 * 数据流：
 * - loadWorkspace 并行读取 `publication.getCatalog` 与 `paragraphs.getCatalog`，
 *   按 chapter.paragraphIds 关联目录摘要构建 Volume→Chapter 层级视图；
 * - 章节内正文（paragraphs.get）在选中章节时懒加载，失败段落留空可重试；
 * - isDraft/changeSetId core 暂无逐章字段，保持 undefined（审批入口按 changeSetId 可选）。
 */
import {
  canonicalNovelQueryScope,
  noopLogger,
  type Logger,
  type NovelApiClient,
  type NovelParagraphSummary,
  type ParagraphId,
  type PublicationChapter,
  type PublicationVolume,
} from "@novel/core";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
import type { NovelDomainError } from "../../outline/store/StoryOutlineTreeStore.js";

export interface ManuscriptBlockData {
  readonly blockId: string; // 段落 id（ParagraphId）
  readonly digest: string; // 短码 "8f3a70"，取 textDigest 前 6 位，未知为 ""
  readonly isDraft?: boolean;
  readonly text: string; // 正文，未加载为 ""，由 loadChapterText 懒加载填充
  readonly storyUnitId?: string;
  readonly orderKey?: string;
  readonly textLength?: number;
}

export interface ManuscriptChapter {
  readonly chapterId: string; // PublicationChapterId
  readonly volumeId: string;
  readonly title: string; // 权威 publication 标题
  readonly orderKey?: string;
  readonly paragraphIds: readonly string[];
  readonly blocks: readonly ManuscriptBlockData[]; // 按 chapter.paragraphIds 顺序
  readonly isDraft?: boolean;
  readonly changeSetId?: string;
}

export interface ManuscriptVolume {
  readonly volumeId: string;
  readonly title: string;
  readonly orderKey?: string;
  readonly chapters: readonly ManuscriptChapter[];
}

export interface ManuscriptStructureSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly volumes: readonly ManuscriptVolume[];
  readonly chapters: readonly ManuscriptChapter[]; // 平铺有序，供引用解析/查找
  readonly selectedChapterId: string | undefined;
  readonly error: NovelDomainError | undefined;
}

const EMPTY_SNAPSHOT: ManuscriptStructureSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  volumes: Object.freeze([]),
  chapters: Object.freeze([]),
  selectedChapterId: undefined,
  error: undefined,
});

export class ManuscriptStructureStore extends ExternalStore<ManuscriptStructureSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private generation = 0;
  private readonly loadedChapterText = new Set<string>();
  private readonly pendingTextLoads = new Set<string>();

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY_SNAPSHOT);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "manuscript_structure_store",
    });
  }

  async loadWorkspace(workspaceId: string): Promise<void> {
    const capturedId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    this.loadedChapterText.clear();
    this.pendingTextLoads.clear();
    this.setSnapshot({
      ...EMPTY_SNAPSHOT,
      phase: "loading",
      workspaceId: capturedId,
    });
    try {
      const [publication, paragraphCatalog] = await Promise.all([
        this.api.novel.publication.getCatalog(canonicalNovelQueryScope),
        this.api.novel.paragraphs.getCatalog(canonicalNovelQueryScope),
      ]);
      if (generation !== this.generation) return;
      const { volumes, chapters } = buildPublicationView(
        publication?.volumes ?? [],
        publication?.chapters ?? [],
        paragraphCatalog?.paragraphs ?? [],
      );
      const firstChapterId = chapters[0]?.chapterId;
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        volumes,
        chapters,
        selectedChapterId: firstChapterId,
        error: undefined,
      });
      if (firstChapterId !== undefined) void this.loadChapterText(firstChapterId);
      this.logger.info("manuscript_structure.load_completed", {
        volumeCount: volumes.length,
        chapterCount: chapters.length,
      });
    } catch {
      if (generation !== this.generation) return;
      this.setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        workspaceId: capturedId,
        error: {
          code: "novel-load-failed",
          message: "正文结构加载失败，请重试",
          retryable: true,
        },
      });
      this.logger.warn("manuscript_structure.load_failed");
    }
  }

  invalidate(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
  }

  selectChapter(chapterId: string | undefined): void {
    this.setSnapshot({ ...this.snapshot, selectedChapterId: chapterId });
    if (chapterId !== undefined) void this.loadChapterText(chapterId);
  }

  /** 懒加载章节正文：并行拉取每段文本，失败段落留空（可重选重试）。 */
  async loadChapterText(chapterId: string): Promise<void> {
    if (this.loadedChapterText.has(chapterId)) return;
    const chapter = this.snapshot.chapters.find((c) => c.chapterId === chapterId);
    if (chapter === undefined || chapter.paragraphIds.length === 0) return;
    if (this.pendingTextLoads.has(chapterId)) return;
    this.pendingTextLoads.add(chapterId);
    const generation = this.generation;
    try {
      const settled = await Promise.allSettled(
        chapter.paragraphIds.map((paragraphId) =>
          this.api.novel.paragraphs.get(
            canonicalNovelQueryScope,
            paragraphId as ParagraphId,
          ),
        ),
      );
      if (generation !== this.generation) return;
      const texts = new Map<string, string>();
      let complete = true;
      for (const result of settled) {
        const paragraph =
          result.status === "fulfilled"
            ? result.value?.readModel?.paragraph
            : undefined;
        if (paragraph === undefined) {
          complete = false;
          continue;
        }
        texts.set(paragraph.id, paragraph.text);
      }
      if (complete) this.loadedChapterText.add(chapterId);
      this.setSnapshot(applyChapterTexts(this.snapshot, chapterId, texts));
    } catch {
      if (generation !== this.generation) return;
      this.logger.warn("manuscript_structure.chapter_text_load_failed", {
        chapterId,
      });
    } finally {
      this.pendingTextLoads.delete(chapterId);
    }
  }
}

/**
 * 用 publication 卷章结构与段落目录摘要构建 Volume→Chapter 视图。
 * chapter 按 core 已排序的 chapters 顺序平铺；卷内章节按相同顺序过滤。
 */
function buildPublicationView(
  volumes: readonly PublicationVolume[],
  chapters: readonly PublicationChapter[],
  paragraphSummaries: readonly NovelParagraphSummary[],
): {
  readonly volumes: readonly ManuscriptVolume[];
  readonly chapters: readonly ManuscriptChapter[];
} {
  const summaryById = new Map<string, NovelParagraphSummary>();
  for (const summary of paragraphSummaries) {
    summaryById.set(summary.id, summary);
  }
  const manuscriptChapters: ManuscriptChapter[] = chapters.map((chapter) => {
    const blocks = Object.freeze(
      chapter.paragraphIds.map((paragraphId) =>
        toBlockData(paragraphId, summaryById.get(paragraphId)),
      ),
    );
    return Object.freeze({
      chapterId: chapter.id,
      volumeId: chapter.volumeId,
      title: chapter.title,
      ...(chapter.orderKey === undefined ? {} : { orderKey: chapter.orderKey }),
      paragraphIds: chapter.paragraphIds,
      blocks,
    });
  });
  const chapterById = new Map(manuscriptChapters.map((chapter) => [chapter.chapterId, chapter]));
  const manuscriptVolumes = Object.freeze(
    volumes.map((volume) =>
      Object.freeze({
        volumeId: volume.id,
        title: volume.title,
        ...(volume.orderKey === undefined ? {} : { orderKey: volume.orderKey }),
        chapters: Object.freeze(
          chapters
            .filter((chapter) => chapter.volumeId === volume.id)
            .map((chapter) => chapterById.get(chapter.id))
            .filter((chapter): chapter is ManuscriptChapter => chapter !== undefined),
        ),
      }),
    ),
  );
  return {
    volumes: manuscriptVolumes,
    chapters: Object.freeze(manuscriptChapters),
  };
}

function toBlockData(
  paragraphId: string,
  summary: NovelParagraphSummary | undefined,
): ManuscriptBlockData {
  return Object.freeze({
    blockId: paragraphId,
    digest: summary?.textDigest.slice(0, 6) ?? "",
    text: "",
    ...(summary?.storyUnitId !== undefined
      ? { storyUnitId: summary.storyUnitId }
      : {}),
    ...(summary?.orderKey !== undefined ? { orderKey: summary.orderKey } : {}),
    ...(summary?.textLength !== undefined
      ? { textLength: summary.textLength }
      : {}),
  });
}

/**
 * 把懒加载到的段落文本不可变地写入指定章节的 blocks；
 * 未变对象保持引用相等；无变化时原样返回（setSnapshot 会跳过通知）。
 */
function applyChapterTexts(
  snapshot: ManuscriptStructureSnapshot,
  chapterId: string,
  texts: ReadonlyMap<string, string>,
): ManuscriptStructureSnapshot {
  if (texts.size === 0) return snapshot;
  const chapter = snapshot.chapters.find((c) => c.chapterId === chapterId);
  if (chapter === undefined) return snapshot;
  let changed = false;
  const blocks = chapter.blocks.map((block) => {
    const text = texts.get(block.blockId);
    if (text === undefined || text === block.text) return block;
    changed = true;
    return Object.freeze({ ...block, text });
  });
  if (!changed) return snapshot;
  const updatedChapter = Object.freeze({ ...chapter, blocks: Object.freeze(blocks) });
  const chapters = Object.freeze(
    snapshot.chapters.map((c) => (c.chapterId === chapterId ? updatedChapter : c)),
  );
  const volumes = Object.freeze(
    snapshot.volumes.map((volume) => {
      const volumeChapters = volume.chapters.map((c) =>
        c.chapterId === chapterId ? updatedChapter : c,
      );
      if (volumeChapters.every((c, index) => c === volume.chapters[index])) {
        return volume;
      }
      return Object.freeze({ ...volume, chapters: Object.freeze(volumeChapters) });
    }),
  );
  return Object.freeze({ ...snapshot, volumes, chapters });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
