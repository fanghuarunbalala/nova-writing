/**
 * EmptyState
 *
 * 通用空态：图标（accent 浅底圆托）+ 标题 + 描述（楷体）+ 动作，view-in 入场。
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./Icon.js";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {icon !== undefined ? (
        <span className={styles.iconWrap} aria-hidden="true">
          <Icon icon={icon} size="lg" />
        </span>
      ) : null}
      <h4 className={styles.title}>{title}</h4>
      {description !== undefined ? <p className={styles.description}>{description}</p> : null}
      {action !== undefined ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
