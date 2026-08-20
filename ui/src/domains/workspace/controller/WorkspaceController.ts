/** Coordinates Workspace selection and one active Workspace session for shared UI. */
import type { Logger } from "@novel/core";
import { noopLogger } from "@novel/core/client";

export type WorkspaceControllerPhase =
  | "idle"
  | "loading"
  | "selecting"
  | "opening"
  | "ready"
  | "closing"
  | "error";

export interface WorkspaceReferenceView {
  readonly referenceId: string;
  readonly label: string;
}

export interface WorkspaceSessionView {
  readonly id: string;
  readonly label: string;
  /** 最后打开时间（ISO 字符串，registry 透传；旧数据缺省） */
  readonly lastOpenedAt?: string;
  /** 工作区根目录路径（registry 透传；旧数据缺省） */
  readonly rootPath?: string;
}

export interface WorkspaceControllerErrorSnapshot {
  readonly code: string;
  readonly retryable: boolean;
  readonly message: string;
}

export interface WorkspaceControllerSnapshot {
  readonly revision: number;
  readonly phase: WorkspaceControllerPhase;
  readonly current?: WorkspaceSessionView;
  readonly recent: readonly WorkspaceSessionView[];
  readonly error?: WorkspaceControllerErrorSnapshot;
}

export interface WorkspacePickerPort {
  pickWorkspace(): Promise<WorkspaceReferenceView | undefined>;
  /** 新建项目（save 型对话框命名 + 建目录）；宿主未提供时新建入口报不可用 */
  createWorkspace?(): Promise<WorkspaceReferenceView | undefined>;
}

export interface WorkspaceSessionPort {
  listRecent(): Promise<readonly WorkspaceSessionView[]>;
  open(reference: WorkspaceReferenceView): Promise<WorkspaceSessionView>;
  close(): Promise<void>;
  /** 在新 GUI 实例（独立进程/窗口）中打开工作区，当前窗口保持不动；宿主未提供时报不可用 */
  openInNewWindow?(reference: WorkspaceReferenceView): Promise<void>;
  /** 取出宿主派发的启动项目（他实例"新窗口打开"spawn 本实例时注入）；取出即清，仅一次 */
  takeStartupWorkspace?(): Promise<WorkspaceReferenceView | undefined>;
}

export interface WorkspaceControllerOptions {
  readonly picker?: WorkspacePickerPort;
  readonly sessions?: WorkspaceSessionPort;
  readonly logger?: Logger;
}

export type WorkspaceControllerListener = () => void;

export class WorkspaceController {
  private readonly picker: WorkspacePickerPort;
  private readonly sessions: WorkspaceSessionPort;
  private readonly logger: Logger;
  private readonly listeners = new Set<WorkspaceControllerListener>();
  private revision = 0;
  private snapshot: WorkspaceControllerSnapshot = freezeSnapshot({
    revision: 0,
    phase: "idle",
    recent: [],
  });
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceControllerOptions = {}) {
    this.picker = options.picker ?? unavailableWorkspacePicker;
    this.sessions = options.sessions ?? unavailableWorkspaceSessions;
    this.logger = (options.logger ?? noopLogger).child({
      component: "workspace_controller",
    });
  }

  getSnapshot(): WorkspaceControllerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: WorkspaceControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh(): Promise<void> {
    return this.runExclusive(async () => {
      this.publish({ phase: "loading" });
      this.logger.debug("workspace_controller.refresh_started");
      try {
        const recent = captureWorkspaceSessions(await this.sessions.listRecent());
        this.publish({ phase: this.snapshot.current === undefined ? "idle" : "ready", recent });
        this.logger.debug("workspace_controller.refresh_completed", {
          recentCount: recent.length,
        });
      } catch {
        this.reject("WORKSPACE_LIST_FAILED", true, "无法读取最近打开的项目");
      }
    });
  }

  /**
   * 应用主进程推送的已打开会话：renderer 错过 open 响应（重启/自动打开）时
   * 同步 current 与 ready 状态。Applies a workspace-opened push from the main
   * process so the renderer syncs state when it missed the open response.
   */
  notifyOpened(session: WorkspaceSessionView): void {
    const captured = captureWorkspaceSession(session);
    if (this.snapshot.current?.id === captured.id) return;
    this.publish({ phase: "ready", current: captured });
  }

  chooseAndOpen(): Promise<WorkspaceSessionView | undefined> {
    return this.runExclusive(async () => {
      this.publish({ phase: "selecting" });
      this.logger.info("workspace_controller.selection_started");
      let reference: WorkspaceReferenceView | undefined;
      try {
        reference = captureOptionalWorkspaceReference(await this.picker.pickWorkspace());
      } catch {
        this.reject(
          "WORKSPACE_SELECTION_UNAVAILABLE",
          false,
          "当前客户端尚未连接 Workspace 选择服务",
        );
        return undefined;
      }
      if (reference === undefined) {
        this.publish({
          phase: this.snapshot.current === undefined ? "idle" : "ready",
        });
        this.logger.debug("workspace_controller.selection_cancelled");
        return undefined;
      }
      return this.openReference(reference);
    });
  }

  /**
   * 新建项目：save 型对话框命名 → 主进程建目录 → 作为工作区打开。
   * 取消与失败语义同 chooseAndOpen（取消静默回原状态，失败置 error）。
   */
  createAndOpen(): Promise<WorkspaceSessionView | undefined> {
    return this.runExclusive(async () => {
      if (this.picker.createWorkspace === undefined) {
        this.reject(
          "WORKSPACE_CREATE_UNAVAILABLE",
          false,
          "当前客户端尚未连接 Workspace 新建服务",
        );
        return undefined;
      }
      this.publish({ phase: "selecting" });
      this.logger.info("workspace_controller.create_started");
      let reference: WorkspaceReferenceView | undefined;
      try {
        reference = captureOptionalWorkspaceReference(await this.picker.createWorkspace());
      } catch (error) {
        this.reject(
          "WORKSPACE_CREATE_FAILED",
          false,
          error instanceof Error ? error.message : "新建项目文件夹失败",
        );
        return undefined;
      }
      if (reference === undefined) {
        this.publish({
          phase: this.snapshot.current === undefined ? "idle" : "ready",
        });
        this.logger.debug("workspace_controller.create_cancelled");
        return undefined;
      }
      return this.openReference(reference);
    });
  }

  openRecent(workspaceId: string): Promise<WorkspaceSessionView | undefined> {
    return this.runExclusive(async () => {
      const recent = this.snapshot.recent.find((workspace) => workspace.id === workspaceId);
      if (recent === undefined) {
        this.reject("WORKSPACE_RECENT_NOT_FOUND", false, "最近打开的项目不存在");
        return undefined;
      }
      return this.openReference({ referenceId: recent.id, label: recent.label });
    });
  }

  /**
   * 打开指定引用（「从文件导入创建项目」等流程拿到引用后进入常规打开编排；
   * 语义同 open，保留独立命名入口）。
   */
  openDirect(reference: WorkspaceReferenceView): Promise<WorkspaceSessionView | undefined> {
    return this.open(reference);
  }

  /** 仅选择目录（不打开）：切换对话框"先选定项目、再选打开位置"的第一步 */
  pickWorkspaceReference(): Promise<WorkspaceReferenceView | undefined> {
    return this.runExclusive(async () => {
      this.publish({ phase: "selecting" });
      this.logger.info("workspace_controller.pick_started");
      let reference: WorkspaceReferenceView | undefined;
      try {
        reference = captureOptionalWorkspaceReference(await this.picker.pickWorkspace());
      } catch {
        this.reject(
          "WORKSPACE_SELECTION_UNAVAILABLE",
          false,
          "当前客户端尚未连接 Workspace 选择服务",
        );
        return undefined;
      }
      // 选定与取消都回落相位（选定时打开位置面板可交互；取消静默回原状态）
      this.publish({ phase: this.snapshot.current === undefined ? "idle" : "ready" });
      if (reference === undefined) {
        this.logger.debug("workspace_controller.pick_cancelled");
      }
      return reference;
    });
  }

  /** 当前窗口打开（对话框选定"当前窗口"后调用；切换会结束当前项目运行中的对话） */
  open(reference: WorkspaceReferenceView): Promise<WorkspaceSessionView | undefined> {
    return this.runExclusive(() => this.openReference(reference));
  }

  /**
   * 在新 GUI 实例中打开（当前窗口保持不动）：派发后由新实例走完整 open 流程
   * （含同项目双开锁与焦点回切）。
   * @returns 是否派发成功
   */
  openInNewWindow(reference: WorkspaceReferenceView): Promise<boolean> {
    return this.runExclusive(async () => {
      if (this.sessions.openInNewWindow === undefined) {
        this.reject(
          "WORKSPACE_NEW_WINDOW_UNAVAILABLE",
          false,
          "当前客户端尚未连接 Workspace 新窗口打开服务",
        );
        return false;
      }
      this.logger.info("workspace_controller.open_in_new_window_started");
      try {
        await this.sessions.openInNewWindow(captureWorkspaceReference(reference));
        this.logger.info("workspace_controller.open_in_new_window_dispatched");
        return true;
      } catch (error) {
        this.reject(
          "WORKSPACE_NEW_WINDOW_FAILED",
          false,
          errorMessageOf(error, "在新窗口打开失败"),
        );
        return false;
      }
    });
  }

  /**
   * 启动自动打开：宿主派发的启动项目（他实例"新窗口打开"spawn 本实例时注入）。
   * 无上下文或端口缺省时静默跳过；打开失败走 open 的错误展示路径（如双开提示）。
   */
  openStartupWorkspace(): Promise<void> {
    return this.runExclusive(async () => {
      if (this.sessions.takeStartupWorkspace === undefined) return;
      let reference: WorkspaceReferenceView | undefined;
      try {
        reference = captureOptionalWorkspaceReference(
          await this.sessions.takeStartupWorkspace(),
        );
      } catch {
        this.logger.warn("workspace_controller.startup_workspace_take_failed");
        return;
      }
      if (reference === undefined) return;
      this.logger.info("workspace_controller.startup_workspace_found", {
        label: reference.label,
      });
      await this.openReference(reference);
    });
  }

  closeCurrent(): Promise<boolean> {
    return this.runExclusive(async () => {
      if (this.snapshot.current === undefined) return true;
      this.publish({ phase: "closing" });
      this.logger.info("workspace_controller.close_started");
      try {
        await this.sessions.close();
        this.publish({ phase: "idle", current: undefined });
        this.logger.info("workspace_controller.close_completed");
        return true;
      } catch {
        this.reject("WORKSPACE_CLOSE_FAILED", true, "Workspace 关闭失败");
        return false;
      }
    });
  }

  clearError(): void {
    if (this.snapshot.error === undefined) return;
    this.publish({
      phase: this.snapshot.current === undefined ? "idle" : "ready",
      error: undefined,
    });
  }

  private async openReference(
    reference: WorkspaceReferenceView,
  ): Promise<WorkspaceSessionView | undefined> {
    this.publish({ phase: "opening" });
    this.logger.info("workspace_controller.open_started");
    try {
      const current = captureWorkspaceSession(await this.sessions.open(reference));
      const recent = mergeRecent(current, this.snapshot.recent);
      this.publish({ phase: "ready", current, recent });
      this.logger.info("workspace_controller.open_completed", {
        recentCount: recent.length,
      });
      return current;
    } catch (error) {
      // 主进程错误文案直达 UI（如同项目双开的"已为你切换到该窗口"）；空文案回退通用提示
      this.reject("WORKSPACE_OPEN_FAILED", true, errorMessageOf(error, "Workspace 打开失败"));
      return undefined;
    }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private reject(code: string, retryable: boolean, message: string): void {
    this.publish({
      phase: "error",
      error: Object.freeze({ code, retryable, message }),
    });
    this.logger.info("workspace_controller.operation_failed", {
      errorCode: code,
      retryable,
    });
  }

  private publish(
    update: Partial<
      Pick<WorkspaceControllerSnapshot, "phase" | "current" | "recent" | "error">
    >,
  ): void {
    this.revision += 1;
    this.snapshot = freezeSnapshot({
      revision: this.revision,
      phase: update.phase ?? this.snapshot.phase,
      ...(update.current !== undefined
        ? { current: captureWorkspaceSession(update.current) }
        : "current" in update
          ? {}
          : this.snapshot.current !== undefined
            ? { current: this.snapshot.current }
            : {}),
      recent:
        update.recent !== undefined
          ? captureWorkspaceSessions(update.recent)
          : this.snapshot.recent,
      ...(update.error !== undefined
        ? { error: Object.freeze({ ...update.error }) }
        : "error" in update
          ? {}
          : this.snapshot.error !== undefined
            ? { error: this.snapshot.error }
            : {}),
    });
    for (const listener of [...this.listeners]) listener();
  }
}

const unavailableWorkspacePicker: WorkspacePickerPort = Object.freeze({
  pickWorkspace: async () => {
    throw new Error("Workspace picker is unavailable");
  },
});

const unavailableWorkspaceSessions: WorkspaceSessionPort = Object.freeze({
  listRecent: async () => Object.freeze([]),
  open: async () => {
    throw new Error("Workspace sessions are unavailable");
  },
  close: async () => undefined,
});

function mergeRecent(
  current: WorkspaceSessionView,
  recent: readonly WorkspaceSessionView[],
): readonly WorkspaceSessionView[] {
  return Object.freeze([
    current,
    ...recent.filter((workspace) => workspace.id !== current.id),
  ]);
}

function captureOptionalWorkspaceReference(
  reference: WorkspaceReferenceView | undefined,
): WorkspaceReferenceView | undefined {
  return reference === undefined ? undefined : captureWorkspaceReference(reference);
}

function captureWorkspaceReference(
  reference: WorkspaceReferenceView,
): WorkspaceReferenceView {
  return Object.freeze({
    referenceId: requireNonBlank(reference.referenceId, "Workspace reference id"),
    label: requireNonBlank(reference.label, "Workspace label"),
  });
}

function captureWorkspaceSession(session: WorkspaceSessionView): WorkspaceSessionView {
  return Object.freeze({
    id: requireNonBlank(session.id, "Workspace id"),
    label: requireNonBlank(session.label, "Workspace label"),
    ...(captureOptionalField(session.lastOpenedAt) !== undefined
      ? { lastOpenedAt: session.lastOpenedAt }
      : {}),
    ...(captureOptionalField(session.rootPath) !== undefined
      ? { rootPath: session.rootPath }
      : {}),
  });
}

/** 可选字符串字段：非空串才透传（空白/缺省视为无数据） */
function captureOptionalField(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function captureWorkspaceSessions(
  sessions: readonly WorkspaceSessionView[],
): readonly WorkspaceSessionView[] {
  const captured = sessions.map(captureWorkspaceSession);
  const ids = new Set<string>();
  for (const session of captured) {
    if (ids.has(session.id)) throw new TypeError("Workspace ids must be unique");
    ids.add(session.id);
  }
  return Object.freeze(captured);
}

function freezeSnapshot(
  snapshot: WorkspaceControllerSnapshot,
): WorkspaceControllerSnapshot {
  return Object.freeze({
    ...snapshot,
    ...(snapshot.current !== undefined
      ? { current: Object.freeze({ ...snapshot.current }) }
      : {}),
    recent: Object.freeze(snapshot.recent.map((workspace) => Object.freeze({ ...workspace }))),
    ...(snapshot.error !== undefined
      ? { error: Object.freeze({ ...snapshot.error }) }
      : {}),
  });
}

function requireNonBlank(value: string, label: string): string {
  if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
  return value;
}

/** 底层错误的用户可见文案：Error 且 message 非空时透传（kkrpc 会保真远端 message） */
function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
