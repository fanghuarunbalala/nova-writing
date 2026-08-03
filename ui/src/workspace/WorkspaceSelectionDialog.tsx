/** Shared Workspace chooser surface backed by WorkspaceController operations. */
import type { WorkspaceControllerSnapshot } from "./WorkspaceController.js";

export interface WorkspaceSelectionDialogProps {
  readonly open: boolean;
  readonly snapshot: WorkspaceControllerSnapshot;
  readonly onChoose: () => void;
  readonly onOpenRecent: (workspaceId: string) => void;
  readonly onCloseWorkspace: () => void;
  readonly onDismiss: () => void;
}

export function WorkspaceSelectionDialog({
  open,
  snapshot,
  onChoose,
  onOpenRecent,
  onCloseWorkspace,
  onDismiss,
}: WorkspaceSelectionDialogProps) {
  if (!open) return null;
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  return (
    <div className="novel-dialog-backdrop" role="presentation">
      <section
        aria-label="选择 Workspace"
        aria-modal="true"
        className="novel-dialog novel-workspace-dialog"
        role="dialog"
      >
        <header className="novel-dialog-header">
          <div>
            <span>Workspace</span>
            <h2>选择小说项目</h2>
          </div>
          <button aria-label="关闭 Workspace 选择" onClick={onDismiss} type="button">
            ×
          </button>
        </header>
        <div className="novel-dialog-content">
          <p className="novel-dialog-description">
            Workspace 对应一个小说项目根目录；当前窗口一次只打开一个 Workspace。
          </p>
          <button
            className="novel-primary-action"
            disabled={busy}
            onClick={onChoose}
            type="button"
          >
            {snapshot.phase === "selecting" || snapshot.phase === "opening"
              ? "正在打开…"
              : "选择 Workspace…"}
          </button>
          {snapshot.error !== undefined ? (
            <p className="novel-dialog-error" role="status">
              {snapshot.error.message}
            </p>
          ) : null}
          <section className="novel-recent-workspaces">
            <h3>最近使用</h3>
            {snapshot.recent.length === 0 ? (
              <p>暂无最近使用的 Workspace</p>
            ) : (
              snapshot.recent.map((workspace) => (
                <button
                  disabled={busy}
                  key={workspace.id}
                  onClick={() => onOpenRecent(workspace.id)}
                  type="button"
                >
                  <strong>{workspace.label}</strong>
                  <span>{workspace.id}</span>
                </button>
              ))
            )}
          </section>
        </div>
        <footer className="novel-dialog-footer">
          <button
            disabled={busy || snapshot.current === undefined}
            onClick={onCloseWorkspace}
            type="button"
          >
            关闭当前 Workspace
          </button>
          <button onClick={onDismiss} type="button">
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
