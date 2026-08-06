/**
 * Badge
 *
 * 数量角标。超过 max 显示 "max+"。
 */
import styles from "./Badge.module.css";

export type BadgeVariant = "default" | "warn" | "danger" | "success";

export interface BadgeProps {
  readonly count: number;
  readonly variant?: BadgeVariant;
  readonly max?: number; // 超过显示 max+
}

export function Badge({ count, variant = "default", max = 99 }: BadgeProps) {
  const label = count > max ? `${max}+` : String(count);
  return (
    <span className={[styles.badge, styles[variant]].filter(Boolean).join(" ")} aria-label={`${count} 项`}>
      {label}
    </span>
  );
}
