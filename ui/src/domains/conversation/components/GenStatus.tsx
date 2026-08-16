/**
 * GenStatus
 *
 * 生成状态行（原型 .gen-status）：扁平行，位于 composer 输入框正上方。
 * phase: generating / waiting / failed（thinking 已随 loop 层丢弃 reasoning delta 移除）。
 * - generating（live）经 RuntimeStatusIndicator 展示统一语言
 *   （图标动效 + 渐变流动文字 + 秒数），live 时展示已用秒数。
 * - waiting（审批挂起）展示沙漏琥珀态，无秒数。
 * - queuedCount > 0 时行尾追加「排队中 N 条」（生成中再发送 → 消息排队等收口，本地计数）。
 * - failed：alert 图标（出现时一次性微抖动）+ 红色加粗「生成失败」+ 具体原因 + 图标重试
 *   （终结态不做循环动效，避免误导「还在工作」）。
 * 已移除三点呼吸 dots 与停止按钮（对齐新三态语言）。
 */
import { CircleAlert, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator.js";
import styles from "./GenStatus.module.css";

export interface GenStatusProps {
  readonly phase: "generating" | "waiting" | "failed";
  readonly error?: string;
  readonly onRetry?: () => void;
  /** 排队中的消息数（>0 时追加「排队中 N 条」后缀；发送后本地计数，见 ChatSurface） */
  readonly queuedCount?: number;
  /** 审批挂起时点击状态行唤回审批弹窗（提供时 waiting 升级为可点胶囊） */
  readonly onWaitingClick?: () => void;
}

export function GenStatus({ phase, error, onRetry, queuedCount, onWaitingClick }: GenStatusProps) {
  const live = phase === "generating";
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
    // 显示为整秒粒度，1s 周期足够（gui-performance-2 功能点七：250ms→1s 降载 75%）
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000)));
    }, 1000);
    return () => {
      window.clearInterval(timer);
      startRef.current = null;
    };
  }, [live]);

  if (phase === "failed") {
    return (
      <div className={[styles.status, styles.failed].join(" ")} role="status">
        <span className={styles.icon}>
          <Icon icon={CircleAlert} size="sm" />
        </span>
        <span className={styles.main}>生成失败</span>
        {error !== undefined ? <span className={styles.error}>{error}</span> : null}
        {onRetry !== undefined ? (
          <button
            type="button"
            className={styles.retry}
            onClick={onRetry}
            aria-label="重试"
          >
            <Icon icon={RotateCcw} size="sm" strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
    );
  }

  // 审批挂起 + 唤起回调：状态行升级为可点胶囊（点击打开审批弹窗）
  if (phase === "waiting" && onWaitingClick !== undefined) {
    return (
      <button
        type="button"
        className={[styles.status, styles.waitingAction].join(" ")}
        onClick={onWaitingClick}
        title="打开审批弹窗"
      >
        <RuntimeStatusIndicator state={phase} seconds={undefined} />
        <span className={styles.queued}>· 点击处理</span>
        {queuedCount !== undefined && queuedCount > 0 ? (
          <span className={styles.queued}>· 排队中 {queuedCount} 条</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className={styles.status} role="status">
      <RuntimeStatusIndicator state={phase} seconds={live ? elapsed : undefined} />
      {queuedCount !== undefined && queuedCount > 0 ? (
        <span className={styles.queued}>· 排队中 {queuedCount} 条</span>
      ) : null}
    </div>
  );
}
