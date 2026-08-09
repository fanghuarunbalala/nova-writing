/**
 * ConversationDialogs
 *
 * 对话列表的重命名 / 删除确认弹窗（G7：替换原生 window.prompt / window.confirm，
 * 二者在 Electron 渲染进程不可用或不一致）。弹窗状态由 ConversationListSection
 * 持有，本组件纯展示 + 回调。
 */
import { Button } from "../../../shared/primitives/Button.js";
import { Dialog } from "../../../shared/primitives/Dialog.js";
import styles from "./ConversationDialogs.module.css";

export interface RenameTarget {
  readonly id: string;
  readonly title: string;
}

export interface ConversationDialogsProps {
  readonly renameTarget?: RenameTarget;
  readonly deleteTarget?: string;
  readonly renameValue: string;
  readonly onRenameValueChange: (value: string) => void;
  readonly onRenameConfirm: () => void;
  readonly onDeleteConfirm: () => void;
  readonly onClose: () => void;
}

export function ConversationDialogs({
  renameTarget,
  deleteTarget,
  renameValue,
  onRenameValueChange,
  onRenameConfirm,
  onDeleteConfirm,
  onClose,
}: ConversationDialogsProps) {
  return (
    <>
      <Dialog
        open={renameTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="重命名对话"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={renameValue.trim() === ""}
              onClick={onRenameConfirm}
            >
              保存
            </Button>
          </>
        }
      >
        <label className={styles.field}>
          <span className={styles.label}>对话名称</span>
          <input
            className={styles.input}
            aria-label="对话名称"
            value={renameValue}
            autoFocus
            onChange={(event) => onRenameValueChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && renameValue.trim() !== "") {
                onRenameConfirm();
              }
            }}
          />
        </label>
      </Dialog>
      <Dialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="删除对话"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button variant="ghost-danger" size="sm" onClick={onDeleteConfirm}>
              删除
            </Button>
          </>
        }
      >
        <p className={styles.deleteText}>
          删除后会话及其记录将被永久移除，且不可恢复。确定删除？
        </p>
      </Dialog>
    </>
  );
}
