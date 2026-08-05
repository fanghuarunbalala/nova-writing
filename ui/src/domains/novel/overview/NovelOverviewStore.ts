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
import {
  canonicalNovelQueryScope,
  noopLogger,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { ExternalStore } from "../../../shared/state/ExternalStore.js";

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
  readonly counts: NovelOverviewCounts;
  readonly error: NovelOverviewError | undefined;
}

const EMPTY_SNAPSHOT: NovelOverviewSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  novelId: undefined,
  label: undefined,
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

export class NovelOverviewStore extends ExternalStore<NovelOverviewSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private generation = 0;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY_SNAPSHOT);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "novel_overview_store",
    });
  }

  loadWorkspace(workspaceId: string): Promise<void> {
    const capturedId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    this.setSnapshot({
      ...EMPTY_SNAPSHOT,
      phase: "loading",
      workspaceId: capturedId,
    });
    return this.run(generation, capturedId, async () => {
      this.logger.info("novel_overview.load_started");
      const overview = await this.api.novel.overview.get(canonicalNovelQueryScope);
      return {
        phase: "ready" as const,
        workspaceId: capturedId,
        novelId: overview.novelId,
        label: overview.novelId,
        counts: {
          storyUnitCount: overview.counts.storyUnitCount,
          characterCount: overview.counts.characterCount,
          locationCount: overview.counts.locationCount,
          volumeCount: overview.counts.volumeCount,
          chapterCount: overview.counts.chapterCount,
          paragraphCount: overview.counts.paragraphCount,
        },
        error: undefined,
      };
    });
  }

  /** 重新加载当前 workspace（审批通过等场景由 shell 协调触发）。 */
  invalidate(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
  }

  retry(): Promise<void> {
    return this.invalidate();
  }

  private async run(
    generation: number,
    workspaceId: string,
    task: () => Promise<Omit<NovelOverviewSnapshot, "phase" | "workspaceId"> & { phase: "ready" }>,
  ): Promise<void> {
    try {
      const next = await task();
      if (generation !== this.generation) return;
      this.setSnapshot({ ...next, workspaceId });
      this.logger.info("novel_overview.load_completed");
    } catch {
      if (generation !== this.generation) return;
      this.setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        workspaceId,
        error: {
          code: "novel-load-failed",
          message: "小说概览加载失败，请重试",
          retryable: true,
        },
      });
      this.logger.warn("novel_overview.load_failed");
    }
  }
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
