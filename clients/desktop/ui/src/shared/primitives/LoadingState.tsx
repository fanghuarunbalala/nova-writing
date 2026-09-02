/**
 * LoadingState
 *
 * 通用加载态：居中 Spinner + 文案。
 */
import { Spinner } from "./Spinner.js";
import styles from "./LoadingState.module.css";

export interface LoadingStateProps {
  readonly label?: string;
}

export function LoadingState({ label = "加载中…" }: LoadingStateProps) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <Spinner />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
