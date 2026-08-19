/**
 * ManuscriptStructureStore
 *
 * 正文结构域 store：以权威 publication 结构（卷 → 章）为目录，
 * 章正文按 paragraphIds 有序选择组装（P3 选择模型：可跨单元/拆分/合并）。
 * 写路径：paragraph insert/update/delete（乐观锁，baseRevision = entityVersion）；
 * 新增段落 = 客户端预生成 id，插段 + 追加章选择合并为单个 mutateBatch
 * （批内原子：stale 整批回滚，不留孤儿段落）。
 *
 * 数据流：
 * - loadWorkspace 读 publication.get（章含 paragraphIds）+ paragraphs.list 全量，
 *   组装 Volume→Chapter 视图（blocks 按选择顺序带全文）。
 */
import type {
  Logger,
  NovelApiClient,
  Paragraph,
  ParagraphId,
  PublicationChapter,
  PublicationVolume,
  StoryUnitId,
} from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { WorkspaceDomainStore, type ReadyWorkspaceDomainSnapshot } from "../../../../shared/state/WorkspaceDomainStore.js";
import { TaskSerializer } from "../../../../shared/state/TaskSerializer.js";
import type { NovelDomainError } from "../../outline/store/StoryOutlineTreeStore.js";

export interface ManuscriptBlockData {
  readonly blockId: string; // 段落 id（ParagraphId）
  readonly digest: string; // 短码（新 core 无 textDigest，置空）
  readonly text: string; // 正文（全文，随 list 返回）
  readonly storyUnitId?: string;
  readonly orderKey?: string;
  readonly textLength?: number;
  /** 实体版本（乐观锁 baseRevision） */
  readonly entityVersion: number;
  /** 草稿态（新 publication 模型无草稿，恒 undefined） */
  readonly isDraft?: boolean;
}

export interface ManuscriptChapter {
  readonly chapterId: string; // PublicationChapterId
  readonly volumeId: string;
  readonly title: string; // 权威 publication 标题
  readonly orderKey?: string;
  /** 实体版本（章选择的乐观锁 baseRevision） */
  readonly entityVersion: number;
  /** 来源提示（P3 起正文以 paragraphIds 选择为准） */
  readonly storyUnitId?: string;
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
  /** 按挂靠单元分组的全部段落（大纲详情「单元段落」数据源；含未入选章选择的段落） */
  readonly unitParagraphs: ReadonlyMap<string, readonly ManuscriptUnitParagraph[]>;
  /** 已被任一章选择收录的段落 id（区分「已入选章 / 未发布」） */
  readonly publishedParagraphIds: ReadonlySet<string>;
  readonly error: NovelDomainError | undefined;
}

/** 大纲单元详情展示用的段落条目（全量 list 的轻量投影） */
export interface ManuscriptUnitParagraph {
  readonly paragraphId: string;
  readonly orderKey?: string;
  readonly text: string;
  readonly textLength: number;
  readonly entityVersion: number;
}

const EMPTY_SNAPSHOT: ManuscriptStructureSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  volumes: Object.freeze([]),
  chapters: Object.freeze([]),
  selectedChapterId: undefined,
  unitParagraphs: new Map<string, readonly ManuscriptUnitParagraph[]>(),
  publishedParagraphIds: new Set<string>(),
  error: undefined,
});

export class ManuscriptStructureStore extends WorkspaceDomainStore<ManuscriptStructureSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  /** 变更串行（乐观锁操作不并发） */
  private readonly serializer = new TaskSerializer();
  /** 段落版本缓存（id → entityVersion，乐观锁 baseRevision 来源） */
  private versionsById: ReadonlyMap<string, number> = new Map();

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(
      EMPTY_SNAPSHOT,
      Object.freeze({
        code: "novel-load-failed",
        message: "正文结构加载失败，请重试",
        retryable: true,
      }),
    );
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "manuscript_structure_store",
    });
  }

  protected async fetchReadySnapshot(
    workspaceId: string,
    generation: number,
  ): Promise<ReadyWorkspaceDomainSnapshot<ManuscriptStructureSnapshot> | undefined> {
    const publication = await this.api.novel.publication.get();
    if (this.isStaleGeneration(generation)) return undefined;
    const allParagraphs = await this.api.novel.paragraphs.list();
    if (this.isStaleGeneration(generation)) return undefined;
    const { volumes, chapters } = buildPublicationView(
      publication.volumes,
      publication.chapters,
      allParagraphs,
    );
    const versionsById = new Map<string, number>();
    const unitParagraphs = new Map<string, ManuscriptUnitParagraph[]>();
    for (const paragraph of allParagraphs) {
      versionsById.set(paragraph.id, paragraph.entityVersion);
      const list = unitParagraphs.get(paragraph.storyUnitId) ?? [];
      list.push(toUnitParagraph(paragraph));
      unitParagraphs.set(paragraph.storyUnitId, list);
    }
    this.versionsById = versionsById;
    // 事件失效刷新保留选中章（章仍在时），避免 agent 写入后阅读器跳回第一章。
    // lastReadySnapshot 仅作「重载而非首载」标志；数据取当前快照（基类 reload 分支已保留用户选中）。
    const prev = this.lastReadySnapshot !== undefined ? this.snapshot : undefined;
    const keepChapterId =
      prev !== undefined &&
      prev.selectedChapterId !== undefined &&
      chapters.some((c) => c.chapterId === prev.selectedChapterId)
        ? prev.selectedChapterId
        : chapters[0]?.chapterId;
    return {
      phase: "ready",
      workspaceId,
      volumes,
      chapters,
      selectedChapterId: keepChapterId,
      unitParagraphs: new Map(
        [...unitParagraphs].map(([unitId, list]) => [unitId, Object.freeze(list)]),
      ),
      publishedParagraphIds: new Set(chapters.flatMap((c) => c.paragraphIds)),
      error: undefined,
    };
  }

  protected override onLoadSucceeded(snapshot: ManuscriptStructureSnapshot): void {
    this.logger.info("manuscript_structure.load_completed", {
      volumeCount: snapshot.volumes.length,
      chapterCount: snapshot.chapters.length,
    });
  }

  protected override onLoadFailed(): void {
    this.logger.warn("manuscript_structure.load_failed");
  }

  selectChapter(chapterId: string | undefined): void {
    this.setSnapshot({ ...this.snapshot, selectedChapterId: chapterId });
  }

  /** 段落版本（乐观锁 baseRevision）；未加载/不存在返回 undefined */
  getParagraphVersion(paragraphId: string): number | undefined {
    return this.versionsById.get(paragraphId);
  }

  /**
   * 新增段落（P3 选择模型）：挂靠到章选择末段的单元，并追加进章选择。
   * 单个 mutateBatch 批内原子（客户端预生成 id 使两步无结果依赖）：
   * 章选择更新 stale → 整批回滚，段落不落库（无孤儿）；重试基于重拉快照与新 id。
   * 节奏标注缺省 hold/3（中性；与旧库迁移默认一致，后续可由作者/Agent 改标）。
   * @param chapterId 目标章
   * @param text 段落文本
   */
  insertParagraph(
    chapterId: string,
    text: string,
    rhythm: "setup" | "rise" | "hold" | "turn" | "climax" | "fall" | "release" | "aftermath" = "hold",
    intensity = 3,
  ): Promise<void> {
    return this.serializer.run(async () => {
      const chapter = this.snapshot.chapters.find((c) => c.chapterId === chapterId);
      await this.runGuarded(async () => {
        if (chapter === undefined || chapter.paragraphIds.length === 0) {
          throw new Error("章节选择为空，无法确定挂靠单元——请先经 Agent 为该章配置段落选择");
        }
        const lastId = chapter.paragraphIds[chapter.paragraphIds.length - 1]!;
        const unitId = chapter.blocks.find((b) => b.blockId === lastId)?.storyUnitId ?? chapter.storyUnitId;
        if (unitId === undefined) {
          throw new Error("无法确定挂靠单元——请先经 Agent 为该章配置段落选择");
        }
        const paragraphId = newParagraphId();
        await this.api.novel.mutateBatch([
          { op: "paragraph.insert", id: paragraphId, storyUnitId: unitId as StoryUnitId, text, rhythm, intensity },
          {
            op: "publication.chapter.update",
            chapterId: chapterId as never,
            baseRevision: chapter.entityVersion,
            patch: { paragraphIds: [...chapter.paragraphIds, paragraphId] as never },
          },
        ]);
      }, "段落");
    });
  }

  /**
   * 更新段落文本（乐观锁；stale 自动重拉 + 提示）
   * @param paragraphId 段落 id
   * @param text 新文本
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  updateParagraph(paragraphId: string, text: string, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "paragraph.update",
            paragraphId: paragraphId as ParagraphId,
            baseRevision,
            text,
          }),
        "段落",
      );
    });
  }

  /**
   * 删除段落（乐观锁；成功后刷新）
   * @param paragraphId 段落 id
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  deleteParagraph(paragraphId: string, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "paragraph.delete",
            paragraphId: paragraphId as ParagraphId,
            baseRevision,
          }),
        "段落",
      );
    });
  }

  /** 变更执行 + stale/通用错误处理（stale → 自动重拉 + 置错误提示） */
  private async runGuarded(mutate: () => Promise<unknown>, label: string): Promise<void> {
    try {
      await mutate();
      this.setSnapshot({ ...this.snapshot, error: undefined });
      const workspaceId = this.snapshot.workspaceId;
      if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === "stale") {
        this.setSnapshot({
          ...this.snapshot,
          error: {
            code: "novel-stale",
            message: `${label}数据已被更新，已刷新为最新版本，请重试`,
            retryable: true,
          },
        });
        const workspaceId = this.snapshot.workspaceId;
        if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
        return;
      }
      this.setSnapshot({
        ...this.snapshot,
        error: {
          code: "novel-mutate-failed",
          message: `${label}保存失败，请重试`,
          retryable: true,
        },
      });
      this.logger.warn("manuscript_structure.mutate_failed");
    }
  }
}

/** 段落全量索引（章选择引用解析用；paragraphs.list 缺省全量） */

/**
 * 用 publication 卷章结构与章选择（paragraphIds 有序）组装 Volume→Chapter 视图。
 * 选择引用的段落缺失（被删未清理）时跳过该段，不阻塞视图。
 */
function buildPublicationView(
  volumes: readonly PublicationVolume[],
  chapters: readonly PublicationChapter[],
  allParagraphs: readonly Paragraph[],
): {
  readonly volumes: readonly ManuscriptVolume[];
  readonly chapters: readonly ManuscriptChapter[];
} {
  const paragraphById = new Map(allParagraphs.map((p) => [p.id, p]));
  const manuscriptChapters: ManuscriptChapter[] = chapters.map((chapter) => {
    const selected = (chapter.paragraphIds ?? [])
      .map((id) => paragraphById.get(id))
      .filter((p): p is Paragraph => p !== undefined);
    const blocks = Object.freeze(selected.map(toBlockData));
    return Object.freeze({
      chapterId: chapter.id,
      volumeId: chapter.volumeId ?? "",
      title: chapter.title,
      entityVersion: chapter.entityVersion,
      ...(chapter.orderKey === undefined ? {} : { orderKey: chapter.orderKey }),
      ...(chapter.storyUnitId === undefined ? {} : { storyUnitId: chapter.storyUnitId }),
      paragraphIds: Object.freeze(selected.map((p) => p.id)),
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
    entityVersion: paragraph.entityVersion,
  });
}

function toUnitParagraph(paragraph: Paragraph): ManuscriptUnitParagraph {
  return {
    paragraphId: paragraph.id,
    ...(paragraph.orderKey === undefined ? {} : { orderKey: paragraph.orderKey }),
    text: paragraph.text,
    textLength: paragraph.text.length,
    entityVersion: paragraph.entityVersion,
  };
}

/** 客户端段落 id（para_ 前缀 + 随机；匹配 core ID_PATTERN，插段与章选择更新可合并单批原子提交） */
function newParagraphId(): string {
  return `para_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
