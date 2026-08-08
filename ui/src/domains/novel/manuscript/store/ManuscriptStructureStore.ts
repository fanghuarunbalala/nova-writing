/**
 * ManuscriptStructureStore
 *
 * 手稿结构域 store：从 core 加载段落目录（NovelParagraphCatalogSnapshot），
 * 映射成 UI 章节视图。
 *
 * 适配说明（core manuscript -> paragraph 重命名后）：
 * - core client API 仅暴露 `api.novel.paragraphs.getCatalog(scope)`，返回扁平段落列表；
 *   不再暴露 publication.chapters / blocks 两级结构。
 * - 段落带必填 storyUnitId + orderKey，故按 storyUnitId 分组为章节卡（对应原型
 *   卷·章卡）；章节标题由视图层从大纲树解析（本 store 保持纯段落投影）。
 * - 段落正文文本由 `api.novel.paragraphs.get(scope, paragraphId)` 懒加载（Phase 3 inspector）。
 * - revision/isDraft/changeSetId core 暂无字段，保持 undefined。
 */
import {
  canonicalNovelQueryScope,
  noopLogger,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
import type { NovelDomainError } from "../../outline/store/StoryOutlineTreeStore.js";

export interface ManuscriptBlockData {
  readonly blockId: string; // 段落 id（ParagraphId）
  readonly digest: string; // 短码 "8f3a70"，取 textDigest 前 6 位
  readonly isDraft?: boolean;
  readonly text: string; // 正文，结构快照中为空，由详情懒加载
  readonly storyUnitId?: string;
  readonly orderKey?: string;
  readonly textLength?: number;
}

export interface ManuscriptChapter {
  readonly chapterId: string;
  readonly title: string;
  readonly revision?: string;
  readonly isDraft?: boolean;
  readonly changeSetId?: string;
  readonly blocks: readonly ManuscriptBlockData[];
}

export interface ManuscriptStructureSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly chapters: readonly ManuscriptChapter[];
  readonly error: NovelDomainError | undefined;
}

const EMPTY_SNAPSHOT: ManuscriptStructureSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  chapters: Object.freeze([]),
  error: undefined,
});

export class ManuscriptStructureStore extends ExternalStore<ManuscriptStructureSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private generation = 0;

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
    this.setSnapshot({
      ...EMPTY_SNAPSHOT,
      phase: "loading",
      workspaceId: capturedId,
    });
    try {
      const catalog = await this.api.novel.paragraphs.getCatalog(canonicalNovelQueryScope);
      if (generation !== this.generation) return;
      const chapters = captureChapters(catalog?.paragraphs ?? []);
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        chapters,
        error: undefined,
      });
      this.logger.info("manuscript_structure.load_completed", {
        chapterCount: chapters.length,
        paragraphCount: chapters.reduce((total, chapter) => total + chapter.blocks.length, 0),
      });
    } catch {
      if (generation !== this.generation) return;
      this.setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        workspaceId: capturedId,
        error: {
          code: "novel-load-failed",
          message: "手稿结构加载失败，请重试",
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
}

/** 未归属 storyUnit 的段落回退组 chapterId（"全部段落"）。 */
const UNGROUPED_CHAPTER_ID = "__all_paragraphs__";

/**
 * 把扁平段落列表按 storyUnitId 分组为章节卡。
 * 章节按首个 block 的 orderKey 排序；章节内 block 按 orderKey 排序。
 * storyUnitId 缺失的段落归入回退组（"全部段落"）；标题留 storyUnitId 占位，
 * 由视图层从大纲树解析真实标题。
 */
function captureChapters(
  paragraphs: readonly {
    readonly id: string;
    readonly storyUnitId?: string;
    readonly orderKey?: string;
    readonly textLength?: number;
    readonly textDigest: string;
  }[],
): readonly ManuscriptChapter[] {
  if (paragraphs.length === 0) return Object.freeze([]);
  const groups = new Map<string, ManuscriptBlockData[]>();
  for (const paragraph of paragraphs) {
    const chapterId = paragraph.storyUnitId ?? UNGROUPED_CHAPTER_ID;
    const blocks = groups.get(chapterId) ?? [];
    blocks.push(toBlockData(paragraph));
    groups.set(chapterId, blocks);
  }
  const chapters: ManuscriptChapter[] = [];
  for (const [chapterId, blocks] of groups) {
    const sortedBlocks = Object.freeze(
      [...blocks].sort((left, right) => compareBlockOrder(left, right)),
    );
    chapters.push(
      Object.freeze({
        chapterId,
        title: chapterId === UNGROUPED_CHAPTER_ID ? "全部段落" : chapterId,
        blocks: sortedBlocks,
      }),
    );
  }
  return Object.freeze(
    chapters.sort((left, right) =>
      compareBlockOrder(left.blocks[0], right.blocks[0]),
    ),
  );
}

function toBlockData(
  paragraph: {
    readonly id: string;
    readonly storyUnitId?: string;
    readonly orderKey?: string;
    readonly textLength?: number;
    readonly textDigest: string;
  },
): ManuscriptBlockData {
  return Object.freeze({
    blockId: paragraph.id,
    digest: paragraph.textDigest.slice(0, 6),
    text: "",
    ...(paragraph.storyUnitId !== undefined
      ? { storyUnitId: paragraph.storyUnitId }
      : {}),
    ...(paragraph.orderKey !== undefined ? { orderKey: paragraph.orderKey } : {}),
    ...(paragraph.textLength !== undefined
      ? { textLength: paragraph.textLength }
      : {}),
  });
}

/**
 * 按 orderKey 排序；缺失 orderKey 的 block 排在后面（保持原相对顺序）。
 * OrderKey 为固定宽度大写 hex 数字组，字典序即数值序（与 core compareOrderKeys
 * 语义一致），故直接字符串比较。
 */
function compareBlockOrder(
  left: ManuscriptBlockData,
  right: ManuscriptBlockData,
): number {
  if (left.orderKey === undefined && right.orderKey === undefined) return 0;
  if (left.orderKey === undefined) return 1;
  if (right.orderKey === undefined) return -1;
  if (left.orderKey < right.orderKey) return -1;
  if (left.orderKey > right.orderKey) return 1;
  return 0;
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
