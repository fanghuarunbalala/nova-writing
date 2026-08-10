/**
 * GenStatus
 *
 * 生成状态行（原型 .gen-status）：扁平行，位于 composer 输入框正上方。
 * phase: thinking / generating / waiting / failed。
 * - thinking / generating（live）经 RuntimeStatusIndicator 展示三态统一语言
 *   （图标动效 + 渐变流动文字 + 秒数），live 时展示已用秒数。
 * - waiting（审批挂起）展示沙漏琥珀态，无秒数。
 * - failed 显示红色错误标识并可重试。
 * 已移除三点呼吸 dots 与停止按钮（对齐新三态语言）。
 */
import { useEffect, useRef, useState } from "react";
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator.js";
import styles from "./GenStatus.module.css";

export interface GenStatusProps {
  readonly phase: "thinking" | "generating" | "waiting" | "failed";
  readonly error?: string;
  readonly onRetry?: () => void;
}

export function GenStatus({ phase, error, onRetry }: GenStatusProps) {
  const live = phase === "thinking" || phase === "generating";
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // 计时：live 时每秒刷新"秒数"，离开 live 复位为 0。
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

  if (phase === "failed") {
    return (
      <div className={[styles.status, styles.failed].join(" ")} role="status">
        <span className={styles.main}>生成失败</span>
        {error !== undefined ? <span className={styles.error}>{error}</span> : null}
        {onRetry !== undefined ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            重试
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.status} role="status">
      <RuntimeStatusIndicator state={phase} seconds={live ? elapsed : undefined} />
    </div>
  );
}
