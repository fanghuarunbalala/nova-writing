/**
 * Dialog
 *
 * 基于 @radix-ui/react-dialog 的模态弹窗。
 * 含焦点陷阱、ESC 关闭、点击遮罩关闭；size 控制最大宽度。
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./Icon.js";
import styles from "./Dialog.module.css";

export type DialogSize = "sm" | "md" | "lg" | "xl";

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly size?: DialogSize;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
  footer,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.overlay} />
        <DialogPrimitive.Content
          className={[styles.content, styles[size]].filter(Boolean).join(" ")}
          aria-label={title === undefined ? "对话框" : undefined}
        >
          {title !== undefined ? (
            <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
          ) : null}
          {description !== undefined ? (
            <DialogPrimitive.Description className={styles.description}>
              {description}
            </DialogPrimitive.Description>
          ) : null}
          <div className={styles.body}>{children}</div>
          {footer !== undefined ? <div className={styles.footer}>{footer}</div> : null}
          <DialogPrimitive.Close className={styles.close} aria-label="关闭">
            <Icon icon={X} size="sm" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
