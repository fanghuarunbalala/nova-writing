/**
 * WorkspaceDomainStore
 *
 * 域 store 泛型基类：封装 loadWorkspace 的通用骨架——
 * - generation 计数竞态防护（旧请求结果丢弃）
 * - phase 状态机（loading → ready / error，错误快照基于初始快照重建）
 * - invalidate()（snapshot.workspaceId 为空时 no-op）
 * 子类只需提供 fetch 数据与构造 ready 快照的钩子；错误文案（角色/地点/大纲…）
 * 通过构造参数 loadError 注入，保证各域文案不变。
 */
import { ExternalStore } from "./ExternalStore.js";

/** 域快照公共契约：phase 状态机 + workspace 上下文 + 错误信息 */
export interface WorkspaceDomainSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } | undefined;
}

/** ready 快照形态：子类钩子返回的快照必须处于 ready 态 */
export type ReadyWorkspaceDomainSnapshot<S> = Omit<S, "phase" | "workspaceId"> & {
  readonly phase: "ready";
  readonly workspaceId: string;
};

export abstract class WorkspaceDomainStore<S extends WorkspaceDomainSnapshot> extends ExternalStore<S> {
  /** 初始（idle/错误重建用）快照 */
  protected readonly initialSnapshot: S;
  /**
   * 最近一次 ready 快照：事件失效刷新时子类 fetchReadySnapshot 用于保留视图状态
   * （选中/展开等）——loadWorkspace 进入 loading 后 snapshot.phase 已非 ready，无法回看。
   * 首次加载 / 切换工作区时清除。
   */
  protected lastReadySnapshot: S | undefined;
  private generation = 0;
  private readonly loadError: NonNullable<S["error"]>;

  /**
   * @param initial 初始快照（idle）
   * @param loadError 加载失败的错误信息（各域文案不同，由子类注入）
   */
  protected constructor(initial: S, loadError: NonNullable<S["error"]>) {
    super(initial);
    this.initialSnapshot = initial;
    this.loadError = loadError;
  }

  /**
   * 拉取数据并构造 ready 快照（含 error: undefined）。
   * 多阶段拉取可随时用 isStaleGeneration(generation) 判断是否已被新一轮加载取代；
   * 已取代时返回 undefined（基类静默丢弃本次结果）。
   */
  protected abstract fetchReadySnapshot(
    workspaceId: string,
    generation: number,
  ): Promise<ReadyWorkspaceDomainSnapshot<S> | undefined>;

  /** 加载成功钩子（默认空；子类用于打点日志） */
  protected onLoadSucceeded(_snapshot: S): void {}

  /** 加载失败钩子（默认空；子类用于打点日志） */
  protected onLoadFailed(): void {}

  /** 当前 generation 是否已被更新一轮加载取代（旧请求应丢弃结果） */
  protected isStaleGeneration(generation: number): boolean {
    return generation !== this.generation;
  }

  /** 当前 generation（子类细粒度加载如 loadDetail 用于竞态判定） */
  protected get currentGeneration(): number {
    return this.generation;
  }

  async loadWorkspace(workspaceId: string): Promise<void> {
    const capturedId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    // 同工作区重载（事件失效刷新）：保留现有数据置 loading，避免视图闪空；
    // 首次加载 / 切换工作区仍从初始快照起步（且清除旧视图状态保留基线）。
    const reload = this.snapshot.workspaceId === capturedId && this.snapshot.phase === "ready";
    if (!reload) this.lastReadySnapshot = undefined;
    this.setSnapshot(
      reload
        ? { ...this.snapshot, phase: "loading", error: undefined }
        : { ...this.initialSnapshot, phase: "loading", workspaceId: capturedId },
    );
    try {
      const next = await this.fetchReadySnapshot(capturedId, generation);
      if (next === undefined || this.isStaleGeneration(generation)) return;
      this.setSnapshot(next as S);
      this.lastReadySnapshot = next as S;
      this.onLoadSucceeded(next as S);
    } catch {
      if (this.isStaleGeneration(generation)) return;
      // 重载失败同样保数据（旧视图 + 错误提示）；首载失败基于初始快照
      this.setSnapshot(
        reload
          ? { ...this.snapshot, phase: "error", error: this.loadError }
          : {
              ...this.initialSnapshot,
              phase: "error",
              workspaceId: capturedId,
              error: this.loadError,
            },
      );
      this.onLoadFailed();
    }
  }

  /** 重新加载当前 workspace（事件后条件 reload）；workspaceId 为空时 no-op */
  invalidate(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
  }
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
