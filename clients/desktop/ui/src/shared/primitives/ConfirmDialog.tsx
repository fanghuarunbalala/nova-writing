/**
 * ConfirmDialog
 *
 * 通用确认弹窗：替换 window.confirm（Electron 渲染进程原生弹窗不可用，
 * 与 ConversationDialogs 同一动机，抽象为共享原语）。
 * 危险操作走 danger 语义（警示图标 + ghost-danger 确认钮）；
 * busy 期间禁止 ESC/遮罩关闭，防止重复提交。
 */
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { Dialog } from "./Dialog.js";
import { Icon } from "./Icon.js";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "danger" | "primary";
  /** 确认进行中：确认钮转 loading、取消禁用 */
  readonly busy?: boolean;
  readonly onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "删除",
  cancelLabel = "取消",
  tone = "danger",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "ghost-danger" : "primary"}
            size="sm"
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.row}>
        <span className={styles.iconWrap} data-tone={tone}>
          <Icon icon={TriangleAlert} size="md" />
        </span>
        {description !== undefined ? <p className={styles.text}>{description}</p> : null}
      </div>
    </Dialog>
  );
}
