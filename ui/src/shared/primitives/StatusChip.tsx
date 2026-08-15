/**
 * StatusChip
 *
 * 状态文字 chip（原型 .chip）：树行/图例/详情共用的彩色小标签，
 * 七个语义色档（neutral/accent/info/warn/success/danger/faint）。
 */
import type { ReactNode } from "react";
import styles from "./StatusChip.module.css";

export type StatusChipVariant =
  | "neutral"
  | "accent"
  | "info"
  | "warn"
  | "success"
  | "danger"
  | "faint";

export interface StatusChipProps {
  readonly variant: StatusChipVariant;
  readonly children: ReactNode;
  /** 紧凑内距（原型树行 scope chip 的 padding:0 6px 变体） */
  readonly compact?: boolean;
  readonly title?: string;
}

export function StatusChip({ variant, children, compact = false, title }: StatusChipProps) {
  const classes = [styles.chip, styles[variant], compact ? styles.compact : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
