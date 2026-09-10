/**
 * WorkspaceSelectionDialog（纯云端化 ⑥ 云-only）
 *
 * 打开项目的模态弹窗（基于共享 Dialog 原语），两步式：
 * ① 选定云端项目（server 项目列表）→ ② 选择打开位置（当前窗口 / 新窗口）。
 * 列表已过滤当前项目（referenceId 与当前 workspaceId 匹配）；列表项另提供删除入口
 * （server 软删 + 本地缓存清理，danger 二次确认）；在用/跨实例占用校验由主进程兜底报错。
 */
import { useState } from "react";
import { Cloud, Trash2 } from "lucide-react";
import { Dialog } from "../../../shared/primitives/Dialog.js";
import { Button } from "../../../shared/primitives/Button.js";
import { ConfirmDialog } from "../../../shared/primitives/ConfirmDialog.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { WorkspaceControllerSnapshot } from "../controller/WorkspaceController.js";
import type { CloudProjectView } from "./ProjectSelectionPage.js";
import styles from "./WorkspaceSelectionDialog.module.css";

export interface WorkspaceSelectionDialogProps {
  readonly open: boolean;
  readonly snapshot: WorkspaceControllerSnapshot;
  /** 云端项目分区（宿主接线 cloudProjects 时提供；老 main 缺省 → 列表区升级提示） */
  readonly cloudProjects?: {
    readonly projects: ReadonlyArray<CloudProjectView>;
    readonly onOpen: (project: { id: string; name: string }) => void;
    readonly onOpenInNewWindow: (project: { id: string; name: string }) => void;
    /** 删除云端项目（经 danger 确认后调用）；返回是否成功 */
    readonly onDelete: (projectId: string) => Promise<boolean>;
  };
  readonly onCloseWorkspace: () => void;
  readonly onDismiss: () => void;
}

export function WorkspaceSelectionDialog({
  open,
  snapshot,
  cloudProjects,
  onCloseWorkspace,
  onDismiss,
}: WorkspaceSelectionDialogProps) {
  const [pending, setPending] = useState<CloudProjectView | undefined>(undefined);
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  // 切换目标排除当前项目：云端项目经 referenceId（本地登记的 workspaceId）匹配
  const currentId = snapshot.current?.id;
  const switchable = (cloudProjects?.projects ?? [])
    .filter((p) => !p.archived)
    .filter((p) => p.referenceId === undefined || p.referenceId !== currentId);
  // 删除确认弹窗（target/busy 模式）：busy 锁重复提交，结束即关闭
  const [deleteTarget, setDeleteTarget] = useState<CloudProjectView | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined || deleteBusy || cloudProjects === undefined) return;
    setDeleteBusy(true);
    try {
      await cloudProjects.onDelete(deleteTarget.id);
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(undefined);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setPending(undefined);
          onDismiss();
        }
      }}
      title="打开项目"
      description="选择一个云端项目；可在当前窗口打开，或在新窗口独立打开。"
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
          <Button
            variant="secondary"
            onClick={() => {
              setPending(undefined);
              onDismiss();
            }}
          >
            完成
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {pending !== undefined ? (
          <section className={styles.choice}>
            <p className={styles.choiceTitle}>
              打开《{pending.name}》
            </p>
            <div className={styles.choiceActions}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  cloudProjects?.onOpen({ id: pending.id, name: pending.name });
                  setPending(undefined);
                }}
              >
                在当前窗口打开
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  cloudProjects?.onOpenInNewWindow({ id: pending.id, name: pending.name });
                  setPending(undefined);
                }}
              >
                在新窗口打开
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPending(undefined)}>
                取消
              </Button>
            </div>
            <p className={styles.choiceHint}>
              当前窗口打开会结束本项目全部运行中的对话；新窗口打开保持本窗口不动。
            </p>
          </section>
        ) : null}
        {snapshot.error !== undefined ? (
          <p className={styles.error} role="status">
            {snapshot.error.message}
          </p>
        ) : null}
        <section className={styles.recent}>
          <h3 className={styles.recentTitle}>云端项目</h3>
          {cloudProjects === undefined ? (
            <p className={styles.recentEmpty}>当前应用版本不支持云端项目——请更新应用。</p>
          ) : switchable.length === 0 ? (
            <p className={styles.recentEmpty}>没有其他可切换的云端项目</p>
          ) : (
            <ul className={styles.recentList}>
              {switchable.map((project) => (
                <li key={project.id} className={styles.recentItemWrap}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    disabled={busy}
                    onClick={() => setPending(project)}
                  >
                    <span className={styles.recentIcon} aria-hidden="true">
                      <Icon icon={Cloud} size="sm" />
                    </span>
                    <span className={styles.recentText}>
                      <strong className={styles.recentLabel}>{project.name}</strong>
                      <span className={styles.recentId}>云端 · 多端接续</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.recentDelete}
                    disabled={busy}
                    title="删除云端项目"
                    aria-label={`删除云端项目 ${project.name}`}
                    onClick={() => setDeleteTarget(project)}
                  >
                    <Icon icon={Trash2} size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={deleteTarget !== undefined}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(undefined);
        }}
        title="删除云端项目"
        description={
          deleteTarget !== undefined
            ? `确定删除云端项目「${deleteTarget.name}」吗？项目将从你的 server 上删除（所有设备不再可见），本设备的缓存数据一并清理，不可恢复。`
            : undefined
        }
        confirmLabel="删除"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </Dialog>
  );
}
