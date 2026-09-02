/**
 * ProjectImportStatusStore：当前项目的导入解构进度（3s 轮询）。
 * 打开项目后 attach；status=analyzing 期间轮询 importProgress，analyzed/failed/none
 * 停表。analyzed/failed 的瞬间由消费方（NovelApp）对比快照做 toast。
 */
import type { ImportProgress, Logger, NovelApiClient } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { ExternalStore } from "../../../shared/state/ExternalStore.js";

/** 快照（供浮标与 toast 判断） */
export interface ProjectImportStatusSnapshot {
  /** attached 与否 */
  readonly attached: boolean;
  /** 上一次轮询结果（undefined = 尚未取到） */
  readonly progress: ImportProgress | undefined;
  /** retry 进行中 */
  readonly retrying: boolean;
  /** 轮询连续失败计数（网络抖动容错；超阈值保留最后快照并停表） */
  readonly failures: number;
}

const EMPTY: ProjectImportStatusSnapshot = Object.freeze({
  attached: false,
  progress: undefined,
  retrying: false,
  failures: 0,
});

/** 轮询间隔（对齐书库解析进度 3s） */
const POLL_INTERVAL_MS = 3000;

/** 连续失败容忍上限 */
const MAX_FAILURES = 10;

export class ProjectImportStatusStore extends ExternalStore<ProjectImportStatusSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({ component: "project_import_status" });
  }

  /** 打开项目时挂接：立即拉一次，analyzing 期间持续轮询 */
  attach(): void {
    this.setSnapshot({ ...this.getSnapshot(), attached: true, failures: 0 });
    void this.refresh();
    this.ensureTimer();
  }

  /** 关闭/切换项目时摘除 */
  detach(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.setSnapshot({ ...EMPTY });
  }

  /** 重试解构（失败/未派生后）：置 analyzing 乐观更新 + 立即拉取 */
  retry(): Promise<void> {
    this.setSnapshot({ ...this.getSnapshot(), retrying: true });
    return this.api.projectImport
      .retryImportAnalysis()
      .then(() => {
        this.setSnapshot({ ...this.getSnapshot(), retrying: false });
        return this.refresh();
      })
      .catch((err: unknown) => {
        this.setSnapshot({ ...this.getSnapshot(), retrying: false });
        this.logger.warn("project_import_status.retry_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return this.refresh();
      });
  }

  private ensureTimer(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      const snapshot = this.getSnapshot();
      if (!snapshot.attached) return;
      const status = snapshot.progress?.status;
      if (status === "analyzed" || status === "failed" || status === "none") return;
      if (snapshot.failures >= MAX_FAILURES) return;
      void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  private async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const progress = await this.api.projectImport.importProgress();
      this.logger.debug("import_status.poll", {
        status: progress.status,
        covered: progress.coveredBatches,
        total: progress.totalBatches,
        percent: progress.percent,
        unitCount: progress.unitCount,
      });
      this.setSnapshot({ ...this.getSnapshot(), progress, failures: 0 });
    } catch (err) {
      this.logger.debug("project_import_status.poll_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.setSnapshot({ ...this.getSnapshot(), failures: this.getSnapshot().failures + 1 });
    } finally {
      this.inFlight = false;
    }
  }
}
