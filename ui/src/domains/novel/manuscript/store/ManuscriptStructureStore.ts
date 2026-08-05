/**
 * ManuscriptStructureStore
 *
 * 手稿结构域 store：加载 publication 章节 + block 摘要。
 * 说明：core 结构快照只含 block 摘要（textLength/textDigest），
 * 正文文本由详情视图经 api.novel.manuscript.getBlock 懒加载（Phase 3 inspector）。
 * revision/isDraft/changeSetId core 暂无字段，保持 undefined。
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
  readonly blockId: string; // "§3-01-04"
  readonly digest: string; // 短码 "8f3a70"
  readonly isDraft?: boolean;
  readonly text: string;
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
      const structure = await this.api.novel.manuscript.getStructure(canonicalNovelQueryScope);
      if (generation !== this.generation) return;
      const chapters = captureChapters(structure);
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        chapters,
        error: undefined,
      });
      this.logger.info("manuscript_structure.load_completed", { chapterCount: chapters.length });
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

function captureChapters(
  structure: {
    readonly publication?: {
      readonly chapters: readonly { readonly id: string; readonly title: string }[];
    };
    readonly blocks: readonly {
      readonly id: string;
      readonly chapterId: string;
      readonly textDigest: string;
    }[];
  },
): readonly ManuscriptChapter[] {
  const chapters = structure.publication?.chapters ?? [];
  return Object.freeze(
    chapters.map((chapter) => {
      const blocks = structure.blocks
        .filter((block) => block.chapterId === chapter.id)
        .map((block) =>
          Object.freeze({
            blockId: block.id,
            digest: block.textDigest.slice(0, 6),
            text: "",
          }),
        );
      return Object.freeze({
        chapterId: chapter.id,
        title: chapter.title,
        blocks: Object.freeze(blocks),
      });
    }),
  );
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
