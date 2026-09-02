/**
 * Pill
 *
 * 状态标签（审批/状态指示等），变体配色见 spec 2.2.11。
 */
import type { ReactNode } from "react";
import styles from "./Pill.module.css";

export type PillVariant = "pending" | "approved" | "changed" | "info";

export interface PillProps {
  readonly variant: PillVariant;
  readonly children: ReactNode;
}

export function Pill({ variant, children }: PillProps) {
  return <span className={[styles.pill, styles[variant]].filter(Boolean).join(" ")}>{children}</span>;
}
