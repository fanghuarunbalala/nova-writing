/**
 * GenStatus
 *
 * 生成状态行（原型 .gen-status）：扁平行（无边框无底色）+ 三点呼吸
 * （.gen-dots i，错峰延迟）+ 纯 muted 主文案，位于 composer 输入框正上方。
 * live 时展示已用计时与停止按钮。
 * phase: idle/streaming/thinking/completed/failed；
 * 仅 streaming/thinking 有柔和动效，failed 用红色标识并可重试。
 *
 * 中文注释：elapsed 计时在 live 相位启动，离开 live 复位为 0 秒；
 * 停止按钮仅在 live 显示，触发 onStop（调用方 enqueue StopInputEvent）。
 */
import { useEffect, useRef, useState } from "react";
import styles from "./GenStatus.module.css";

export interface GenStatusProps {
  readonly phase: "idle" | "streaming" | "thinking" | "completed" | "failed";
  readonly stage?: string;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly onStop?: () => void;
}

const PHASE_TEXT: Record<GenStatusProps["phase"], string> = {
  idle: "",
  streaming: "正在生成…",
  thinking: "正在思考…",
  completed: "已完成",
  failed: "生成失败",
};

export function GenStatus({ phase, stage, error, onRetry, onStop }: GenStatusProps) {
  const live = phase === "streaming" || phase === "thinking";
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // 计时：live 时每秒刷新"已用时"，离开 live 复位。
  useEffect(() => {
    if (!live) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000)));
    }, 250);
    return () => {
      window.clearInterval(timer);
      startRef.current = null;
    };
  }, [live]);

  if (phase === "idle") return null;
  return (
    <div
      className={[styles.status, styles[phase]].filter(Boolean).join(" ")}
      role="status"
      data-live={live || undefined}
    >
      {live ? (
        <span className={styles.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <span className={styles.main}>{stage ?? PHASE_TEXT[phase]}</span>
      {live ? <span className={styles.elapsed}>已用时 {elapsed} 秒</span> : null}
      {live && onStop !== undefined ? (
        <button type="button" className={styles.stop} onClick={onStop}>
          停止
        </button>
      ) : null}
      {phase === "failed" && error !== undefined ? <span className={styles.error}>{error}</span> : null}
      {phase === "failed" && onRetry !== undefined ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
