/**
 * ManuscriptStructureStore
 *
 * 正文结构域 store：以权威 publication 结构（卷 → 章）为目录，
 * 段落按 chapter.storyUnitId 关联（paragraphs.list 返回全文，无需懒加载）。
 *
 * 数据流（新 core）：
 * - loadWorkspace 读 publication.get → 卷/章；按章 storyUnitId 读 paragraphs.list，
 *   组装 Volume→Chapter 视图（blocks 直接带全文）。
 */
import type {
  Logger,
  NovelApiClient,
  Paragraph,
  PublicationChapter,
  PublicationVolume,
  StoryUnitId,
} from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
import type { NovelDomainError } from "../../outline/store/StoryOutlineTreeStore.js";

export interface ManuscriptBlockData {
  readonly blockId: string; // 段落 id（ParagraphId）
  readonly digest: string; // 短码（新 core 无 textDigest，置空）
  readonly text: string; // 正文（全文，随 list 返回）
  readonly storyUnitId?: string;
  readonly orderKey?: string;
  readonly textLength?: number;
  /** 草稿态（新 publication 模型无草稿，恒 undefined） */
  readonly isDraft?: boolean;
}

export interface ManuscriptChapter {
  readonly chapterId: string; // PublicationChapterId
  readonly volumeId: string;
  readonly title: string; // 权威 publication 标题
  readonly orderKey?: string;
  readonly paragraphIds: readonly string[];
  readonly blocks: readonly ManuscriptBlockData[]; // 按段落 orderKey 顺序
  /** 草稿态（新 publication 模型无草稿，恒 undefined） */
  readonly isDraft?: boolean;
  /** 变更集 id（延后，恒 undefined） */
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
      const publication = await this.api.novel.publication.get();
      if (generation !== this.generation) return;
      const paragraphsByStoryUnit = await loadParagraphsByStoryUnit(
        this.api,
        publication.chapters,
      );
      if (generation !== this.generation) return;
      const { volumes, chapters } = buildPublicationView(
        publication.volumes,
        publication.chapters,
        paragraphsByStoryUnit,
      );
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        volumes,
        chapters,
        selectedChapterId: chapters[0]?.chapterId,
        error: undefined,
      });
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
  }
}

/** 按章的 storyUnitId 批量读段落（去重；段落实例全文返回）。 */
async function loadParagraphsByStoryUnit(
  api: NovelApiClient,
  chapters: readonly PublicationChapter[],
): Promise<Map<string, Paragraph[]>> {
  const storyUnitIds: StoryUnitId[] = [];
  for (const chapter of chapters) {
    if (chapter.storyUnitId !== undefined && !storyUnitIds.includes(chapter.storyUnitId)) {
      storyUnitIds.push(chapter.storyUnitId);
    }
  }
  const map = new Map<string, Paragraph[]>();
  for (const storyUnitId of storyUnitIds) {
    map.set(storyUnitId, await api.novel.paragraphs.list(storyUnitId));
  }
  return map;
}

/**
 * 用 publication 卷章结构与按 storyUnitId 关联的段落组装 Volume→Chapter 视图。
 */
function buildPublicationView(
  volumes: readonly PublicationVolume[],
  chapters: readonly PublicationChapter[],
  paragraphsByStoryUnit: ReadonlyMap<string, readonly Paragraph[]>,
): {
  readonly volumes: readonly ManuscriptVolume[];
  readonly chapters: readonly ManuscriptChapter[];
} {
  const manuscriptChapters: ManuscriptChapter[] = chapters.map((chapter) => {
    const paragraphs =
      chapter.storyUnitId !== undefined
        ? (paragraphsByStoryUnit.get(chapter.storyUnitId) ?? [])
        : [];
    const blocks = Object.freeze(paragraphs.map(toBlockData));
    return Object.freeze({
      chapterId: chapter.id,
      volumeId: chapter.volumeId ?? "",
      title: chapter.title,
      ...(chapter.orderKey === undefined ? {} : { orderKey: chapter.orderKey }),
      paragraphIds: Object.freeze(paragraphs.map((p) => p.id)),
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

function toBlockData(paragraph: Paragraph): ManuscriptBlockData {
  return Object.freeze({
    blockId: paragraph.id,
    digest: "",
    text: paragraph.text,
    storyUnitId: paragraph.storyUnitId,
    orderKey: paragraph.orderKey,
    textLength: paragraph.text.length,
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
