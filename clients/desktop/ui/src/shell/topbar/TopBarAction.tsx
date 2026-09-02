/**
 * TopBarAction
 *
 * 顶栏通用动作按钮：图标 + 文字 + 可选 badge。
 */
import type { ReactNode } from "react";
import styles from "./TopBarAction.module.css";

export interface TopBarActionProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly badge?: number;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly title?: string;
}

export function TopBarAction({ label, icon, badge, active = false, onClick, title }: TopBarActionProps) {
  return (
    <button
      type="button"
      className={[styles.action, active ? styles.active : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      title={title ?? label}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 ? <span className={styles.badge}>{badge}</span> : null}
    </button>
  );
}
