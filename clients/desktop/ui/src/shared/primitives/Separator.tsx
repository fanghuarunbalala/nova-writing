/**
 * Separator
 *
 * 分割线：水平/垂直，soft/strong 两档。
 */
import styles from "./Separator.module.css";

export interface SeparatorProps {
  readonly orientation?: "horizontal" | "vertical";
  readonly variant?: "soft" | "strong";
}

export function Separator({ orientation = "horizontal", variant = "soft" }: SeparatorProps) {
  return (
    <span
      className={[styles.separator, styles[orientation], styles[variant]].filter(Boolean).join(" ")}
      role="separator"
    />
  );
}
