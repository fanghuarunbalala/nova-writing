/**
 * Spinner
 *
 * 加载指示器。default 用 muted，danger 用 danger 色。
 */
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  readonly size?: "xs" | "sm" | "md";
  readonly variant?: "default" | "danger";
}

export function Spinner({ size = "md", variant = "default" }: SpinnerProps) {
  return (
    <span
      className={[styles.spinner, styles[size], styles[variant]].filter(Boolean).join(" ")}
      role="progressbar"
      aria-label="加载中"
    />
  );
}
