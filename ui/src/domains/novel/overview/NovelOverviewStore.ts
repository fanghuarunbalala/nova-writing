/**
 * NovelOverviewStore
 *
 * 小说概览域 store：从 core 查询 overview（计数/novelId），按 workspace 上下文加载。
 *
 * 说明：
 * - core 的 NovelQueryScope 是 canonical（隐含当前 workspace），loadWorkspace(id)
 *   只做 UI 上下文记录，请求本身用 canonicalNovelQueryScope。
 * - core overview 无 label 字段，snapshot.label 暂取 novelId 占位；
 *   等 workspace metadata API（spec §11 范围外）落地后替换。
 */
import type { Logger, NovelApiClient } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { WorkspaceDomainStore, type ReadyWorkspaceDomainSnapshot } from "../../../shared/state/WorkspaceDomainStore.js";

export type NovelOverviewPhase = "idle" | "loading" | "ready" | "error";

export interface NovelOverviewError {
  readonly code: "novel-load-failed" | "workspace-missing";
  readonly message: string;
  readonly retryable: boolean;
}

export interface NovelOverviewCounts {
  readonly storyUnitCount: number;
  readonly characterCount: number;
  readonly locationCount: number;
  readonly volumeCount: number;
  readonly chapterCount: number;
  readonly paragraphCount: number;
}

export interface NovelOverviewSnapshot {
  readonly phase: NovelOverviewPhase;
  readonly workspaceId: string | undefined;
  readonly novelId: string | undefined;
  readonly label: string | undefined;
  /** 当前正式稿修订号（原型 rev-meta，如 r042）。Current canonical revision. */
  readonly sourceRevision: string | undefined;
  readonly counts: NovelOverviewCounts;
  readonly error: NovelOverviewError | undefined;
}

const EMPTY_SNAPSHOT: NovelOverviewSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  novelId: undefined,
  label: undefined,
  sourceRevision: undefined,
  counts: Object.freeze({
    storyUnitCount: 0,
    characterCount: 0,
    locationCount: 0,
    volumeCount: 0,
    chapterCount: 0,
    paragraphCount: 0,
  }),
  error: undefined,
});

export class NovelOverviewStore extends WorkspaceDomainStore<NovelOverviewSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(
      EMPTY_SNAPSHOT,
      Object.freeze({
        code: "novel-load-failed",
        message: "小说概览加载失败，请重试",
        retryable: true,
      }),
    );
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "novel_overview_store",
    });
  }

  protected async fetchReadySnapshot(
    workspaceId: string,
    _generation: number,
  ): Promise<ReadyWorkspaceDomainSnapshot<NovelOverviewSnapshot>> {
    this.logger.info("novel_overview.load_started");
    const overview = await this.api.novel.overview.get();
    return {
      phase: "ready",
      workspaceId,
      novelId: overview.novelId,
      label: overview.title ?? overview.novelId,
      sourceRevision: undefined,
      counts: {
        storyUnitCount: overview.counts.storyUnits,
        characterCount: overview.counts.characters,
        locationCount: overview.counts.locations,
        volumeCount: overview.counts.volumes,
        chapterCount: overview.counts.chapters,
        paragraphCount: overview.counts.paragraphs,
      },
      error: undefined,
    };
  }

  protected override onLoadSucceeded(_snapshot: NovelOverviewSnapshot): void {
    this.logger.info("novel_overview.load_completed");
  }

  protected override onLoadFailed(): void {
    this.logger.warn("novel_overview.load_failed");
  }

  retry(): Promise<void> {
    return this.invalidate();
  }
}
