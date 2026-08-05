/**
 * ManuscriptStructureStore
 *
 * 手稿结构域 store：从 core 加载段落目录（NovelParagraphCatalogSnapshot），
 * 映射成 UI 章节视图。
 *
 * 适配说明（core manuscript -> paragraph 重命名后）：
 * - core client API 仅暴露 `api.novel.paragraphs.getCatalog(scope)`，返回扁平段落列表；
 *   不再暴露 publication.chapters / blocks 两级结构。
 * - UI 暂用单 chapter 容纳所有段落；Phase C 内容视图打磨阶段决定是否按 storyUnitId
 *   分组、是否引入 publication chapter API（core §11 范围）。
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
        paragraphCount: chapters[0]?.blocks.length ?? 0,
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

/**
 * 把扁平段落列表映射成单 chapter 视图（"全部段落"）。
 * Phase C 打磨阶段决定是否按 storyUnitId 分组或引入 publication chapter 结构。
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
  const blocks = paragraphs.map((paragraph) =>
    Object.freeze({
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
    }),
  );
  return Object.freeze([
    Object.freeze({
      chapterId: "__all_paragraphs__",
      title: "全部段落",
      blocks: Object.freeze(blocks),
    }),
  ]);
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
