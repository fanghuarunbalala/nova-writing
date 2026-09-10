/** Coordinates Workspace selection and one active Workspace session for shared UI. */
import type { Logger } from "@novel/core";
import { noopLogger } from "@novel/core/client";

/**
 * 纯云端化（⑥）：项目打开/新建一律走云端项目列表（CloudProjectsPort），本地目录
 * 选择器/本地最近列表通道退役——本控制器只剩「引用 → 打开/关闭/新窗口/启动上下文」
 * 的编排面。recent 快照字段随 listRecent 一并移除（云端列表由 NovelApp 自行拉取）。
 */

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
  /** 工作区根目录路径（云项目 = 本地缓存目录；registry 透传） */
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
  readonly error?: WorkspaceControllerErrorSnapshot;
}

export interface WorkspaceSessionPort {
  open(reference: WorkspaceReferenceView): Promise<WorkspaceSessionView>;
  close(): Promise<void>;
  /** 在新 GUI 实例（独立进程/窗口）中打开工作区，当前窗口保持不动；宿主未提供时报不可用 */
  openInNewWindow?(reference: WorkspaceReferenceView): Promise<void>;
  /** 取出宿主派发的启动项目（他实例"新窗口打开"spawn 本实例时注入）；取出即清，仅一次 */
  takeStartupWorkspace?(): Promise<WorkspaceReferenceView | undefined>;
}

export interface WorkspaceControllerOptions {
  readonly sessions?: WorkspaceSessionPort;
  readonly logger?: Logger;
}

export type WorkspaceControllerListener = () => void;

export class WorkspaceController {
  private readonly sessions: WorkspaceSessionPort;
  private readonly logger: Logger;
  private readonly listeners = new Set<WorkspaceControllerListener>();
  private revision = 0;
  private snapshot: WorkspaceControllerSnapshot = freezeSnapshot({
    revision: 0,
    phase: "idle",
  });
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceControllerOptions = {}) {
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

  /** 当前窗口打开（云端项目列表选定后调用；切换会结束当前项目运行中的对话） */
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
      this.publish({ phase: "ready", current });
      this.logger.info("workspace_controller.open_completed");
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
      Pick<WorkspaceControllerSnapshot, "phase" | "current" | "error">
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

const unavailableWorkspaceSessions: WorkspaceSessionPort = Object.freeze({
  open: async () => {
    throw new Error("Workspace sessions are unavailable");
  },
  close: async () => undefined,
});

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

function freezeSnapshot(
  snapshot: WorkspaceControllerSnapshot,
): WorkspaceControllerSnapshot {
  return Object.freeze({
    ...snapshot,
    ...(snapshot.current !== undefined
      ? { current: Object.freeze({ ...snapshot.current }) }
      : {}),
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
