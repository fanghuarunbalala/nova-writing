/** Coordinates Workspace selection and one active Workspace session for shared UI. */
import { noopLogger, type Logger } from "@novel/core";

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
}

export interface WorkspaceSessionPort {
  listRecent(): Promise<readonly WorkspaceSessionView[]>;
  open(reference: WorkspaceReferenceView): Promise<WorkspaceSessionView>;
  close(): Promise<void>;
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
    } catch {
      this.reject("WORKSPACE_OPEN_FAILED", true, "Workspace 打开失败");
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
  });
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
