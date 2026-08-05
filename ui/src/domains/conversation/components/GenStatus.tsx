/**
 * GenStatus
 *
 * 生成状态行（原型 .gen-status）：胶囊容器 + 渐变动点 + 渐变文字。
 * phase: idle/streaming/thinking/completed/failed；
 * 仅 streaming/thinking 有柔和动效，failed 用红色标识并可重试。
 */
import styles from "./GenStatus.module.css";

export interface GenStatusProps {
  readonly phase: "idle" | "streaming" | "thinking" | "completed" | "failed";
  readonly stage?: string;
  readonly error?: string;
  readonly onRetry?: () => void;
}

const PHASE_TEXT: Record<GenStatusProps["phase"], string> = {
  idle: "",
  streaming: "正在生成…",
  thinking: "正在思考…",
  completed: "已完成",
  failed: "生成失败",
};

export function GenStatus({ phase, stage, error, onRetry }: GenStatusProps) {
  if (phase === "idle") return null;
  const live = phase === "streaming" || phase === "thinking";
  return (
    <div
      className={[styles.status, styles[phase]].filter(Boolean).join(" ")}
      role="status"
      data-live={live || undefined}
    >
      {live ? <span className={styles.dot} aria-hidden="true" /> : null}
      <span className={styles.main}>{stage ?? PHASE_TEXT[phase]}</span>
      {phase === "failed" && error !== undefined ? <span className={styles.error}>{error}</span> : null}
      {phase === "failed" && onRetry !== undefined ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
