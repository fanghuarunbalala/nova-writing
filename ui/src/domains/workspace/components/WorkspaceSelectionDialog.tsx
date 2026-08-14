/**
 * WorkspaceSelectionDialog
 *
 * 打开项目的模态弹窗（基于共享 Dialog 原语）。
 * 包含：打开按钮 + 错误提示 + 最近打开列表。
 */
import { FolderOpen } from "lucide-react";
import { Dialog } from "../../../shared/primitives/Dialog.js";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
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
          <Button
            variant="ghost"
            disabled={busy || snapshot.current === undefined}
            onClick={onCloseWorkspace}
          >
            关闭当前 Workspace
          </Button>
          <Button variant="secondary" onClick={onDismiss}>
            完成
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <Button
          variant="primary"
          fullWidth
          loading={snapshot.phase === "selecting" || snapshot.phase === "opening"}
          disabled={busy}
          leadingIcon={<Icon icon={FolderOpen} size="sm" />}
          onClick={onChoose}
        >
          {snapshot.phase === "selecting" || snapshot.phase === "opening"
            ? "正在打开…"
            : "打开项目文件夹…"}
        </Button>
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
                    <span className={styles.recentIcon} aria-hidden="true">
                      <Icon icon={FolderOpen} size="sm" />
                    </span>
                    <span className={styles.recentText}>
                      <strong className={styles.recentLabel}>{workspace.label}</strong>
                      <span className={styles.recentId}>{workspace.id}</span>
                    </span>
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
