/**
 * WorkspaceSelectionDialog
 *
 * 打开项目的模态弹窗（基于共享 Dialog 原语）。
 * 包含：打开按钮 + 错误提示 + 最近打开列表。
 */
import { Dialog } from "../../../shared/primitives/Dialog.js";
import type { WorkspaceControllerSnapshot } from "../controller/WorkspaceController.js";
import styles from "./WorkspaceSelectionDialog.module.css";

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
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onDismiss();
      }}
      title="打开项目"
      description="打开一个小说项目文件夹；当前窗口一次只打开一个项目。"
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={busy || snapshot.current === undefined}
            onClick={onCloseWorkspace}
          >
            关闭当前 Workspace
          </button>
          <button type="button" onClick={onDismiss}>
            完成
          </button>
        </>
      }
    >
      <div className={styles.body}>
        <button
          type="button"
          className={styles.choose}
          disabled={busy}
          onClick={onChoose}
        >
          {snapshot.phase === "selecting" || snapshot.phase === "opening"
            ? "正在打开…"
            : "打开项目文件夹…"}
        </button>
        {snapshot.error !== undefined ? (
          <p className={styles.error} role="status">
            {snapshot.error.message}
          </p>
        ) : null}
        <section className={styles.recent}>
          <h3 className={styles.recentTitle}>最近打开</h3>
          {snapshot.recent.length === 0 ? (
            <p className={styles.recentEmpty}>还没有打开过项目</p>
          ) : (
            <ul className={styles.recentList}>
              {snapshot.recent.map((workspace) => (
                <li key={workspace.id}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    disabled={busy}
                    onClick={() => onOpenRecent(workspace.id)}
                  >
                    <strong className={styles.recentLabel}>{workspace.label}</strong>
                    <span className={styles.recentId}>{workspace.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}
