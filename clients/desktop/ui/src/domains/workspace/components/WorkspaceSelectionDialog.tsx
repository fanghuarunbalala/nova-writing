/**
 * WorkspaceSelectionDialog
 *
 * 打开项目的模态弹窗（基于共享 Dialog 原语），两步式：
 * ① 选定项目（目录选择器 / 最近列表）→ ② 选择打开位置（当前窗口 / 新窗口）。
 * 最近列表已过滤当前项目（切换目标排除自身），列表项另提供删除入口
 * （PRD workspace-删除项目）：非当前项目经 danger 二次确认后彻底删除
 * （应用数据 + 整个项目文件夹）；跨实例占用等校验由主进程兜底报错。
 */
import { useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { Dialog } from "../../../shared/primitives/Dialog.js";
import { Button } from "../../../shared/primitives/Button.js";
import { ConfirmDialog } from "../../../shared/primitives/ConfirmDialog.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type {
  WorkspaceControllerSnapshot,
  WorkspaceReferenceView,
  WorkspaceSessionView,
} from "../controller/WorkspaceController.js";
import styles from "./WorkspaceSelectionDialog.module.css";

export interface WorkspaceSelectionDialogProps {
  readonly open: boolean;
  readonly snapshot: WorkspaceControllerSnapshot;
  /** 仅选择目录（原生选择器），不打开；返回 undefined 表示取消 */
  readonly onPick: () => Promise<WorkspaceReferenceView | undefined>;
  /** 在当前窗口打开（切换：结束当前项目运行中的对话） */
  readonly onOpen: (reference: WorkspaceReferenceView) => void;
  /** 在新 GUI 实例（独立窗口）中打开，当前窗口保持不动 */
  readonly onOpenInNewWindow: (reference: WorkspaceReferenceView) => void;
  readonly onCloseWorkspace: () => void;
  /** 删除项目（仅非当前项目；经 danger 确认后调用）；返回是否成功 */
  readonly onDeleteRecent: (workspaceId: string) => Promise<boolean>;
  readonly onDismiss: () => void;
}

export function WorkspaceSelectionDialog({
  open,
  snapshot,
  onPick,
  onOpen,
  onOpenInNewWindow,
  onCloseWorkspace,
  onDeleteRecent,
  onDismiss,
}: WorkspaceSelectionDialogProps) {
  const [pending, setPending] = useState<WorkspaceReferenceView | undefined>(undefined);
  const busy =
    snapshot.phase === "loading" ||
    snapshot.phase === "selecting" ||
    snapshot.phase === "opening" ||
    snapshot.phase === "closing";
  // 切换目标默认排除当前项目（id 为主、rootPath 兜底）：当前书不该出现在"打开项目"列表，
  // 也从源头消除"点了当前项目"的歧义路径；欢迎页（无 current）不受影响
  const currentId = snapshot.current?.id;
  const currentRoot = snapshot.current?.rootPath;
  const switchableRecent = snapshot.recent.filter(
    (workspace) =>
      (currentId === undefined || workspace.id !== currentId) &&
      (currentRoot === undefined || workspace.rootPath !== currentRoot),
  );
  // 删除确认弹窗（参照 ConversationDialogs 的 target/busy 模式）：busy 锁重复提交，
  // 结束（无论成败）即关闭——失败详情经 controller error 通道展示在弹窗错误区
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSessionView | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onDeleteRecent(deleteTarget.id);
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
      description="选择一个小说项目文件夹；可在当前窗口打开，或在新窗口独立打开。"
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
              打开《{pending.label}》
            </p>
            <div className={styles.choiceActions}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  onOpen(pending);
                  setPending(undefined);
                }}
              >
                在当前窗口打开
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onOpenInNewWindow(pending);
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
        <Button
          variant="primary"
          fullWidth
          loading={snapshot.phase === "selecting" || snapshot.phase === "opening"}
          disabled={busy}
          leadingIcon={<Icon icon={FolderOpen} size="sm" />}
          onClick={() => {
            void onPick().then((reference) => {
              if (reference !== undefined) setPending(reference);
            });
          }}
        >
          {snapshot.phase === "selecting" || snapshot.phase === "opening"
            ? "正在选择…"
            : "打开项目文件夹…"}
        </Button>
        {snapshot.error !== undefined ? (
          <p className={styles.error} role="status">
            {snapshot.error.message}
          </p>
        ) : null}
        <section className={styles.recent}>
          <h3 className={styles.recentTitle}>最近打开</h3>
          {switchableRecent.length === 0 ? (
            <p className={styles.recentEmpty}>
              {snapshot.recent.length === 0 ? "还没有打开过项目" : "没有其他可切换的项目"}
            </p>
          ) : (
            <ul className={styles.recentList}>
              {switchableRecent.map((workspace) => (
                <li key={workspace.id} className={styles.recentItemWrap}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    disabled={busy}
                    onClick={() =>
                      setPending({ referenceId: workspace.id, label: workspace.label })
                    }
                  >
                    <span className={styles.recentIcon} aria-hidden="true">
                      <Icon icon={FolderOpen} size="sm" />
                    </span>
                    <span className={styles.recentText}>
                      <strong className={styles.recentLabel}>{workspace.label}</strong>
                      <span className={styles.recentId}>{workspace.id}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.recentDelete}
                    disabled={busy}
                    title="删除项目"
                    aria-label={`删除项目 ${workspace.label}`}
                    onClick={() => setDeleteTarget(workspace)}
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
        title="删除项目"
        description={
          deleteTarget !== undefined
            ? `确定删除项目「${deleteTarget.label}」吗？将永久删除该项目的全部应用数据（小说内容、AI 会话记录等）和整个项目文件夹（含其中的全部文件），不可恢复。${
                deleteTarget.rootPath !== undefined ? `项目文件夹：${deleteTarget.rootPath}` : ""
              }`
            : undefined
        }
        confirmLabel="删除"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </Dialog>
  );
}
