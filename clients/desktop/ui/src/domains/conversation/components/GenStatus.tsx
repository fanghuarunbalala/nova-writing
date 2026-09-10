/**
 * GenStatus
 *
 * 生成状态行（原型 .gen-status）：扁平行，位于 composer 输入框正上方。
 * phase: thinking / generating / waiting / failed。
 * - thinking（reasoning 心跳驱动）经 RuntimeStatusIndicator 展示脑形呼吸 +
 *   「深度思考中」+ 秒数 + 可选「约 N 字」（thinkingChars 千位近似）。
 * - generating（live）经 RuntimeStatusIndicator 展示统一语言
 *   （图标动效 + 渐变流动文字 + 秒数），live 时展示已用秒数。
 * - waiting（审批挂起）展示沙漏琥珀态，无秒数。
 * - queuedCount > 0 时行尾追加「排队中 N 条」（生成中再发送 → 消息排队等收口，本地计数）。
 * - failed：alert 图标（出现时一次性微抖动）+ 红色加粗「生成失败」+ 具体原因 + 图标重试
 *   （终结态不做循环动效，避免误导「还在工作」）。
 * 已移除三点呼吸 dots 与停止按钮（对齐新状态语言）。
 */
import { CircleAlert, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator.js";
import styles from "./GenStatus.module.css";

export interface GenStatusProps {
  readonly phase: "thinking" | "generating" | "waiting" | "failed";
  readonly error?: string;
  readonly onRetry?: () => void;
  /** 排队中的消息数（>0 时追加「排队中 N 条」后缀；发送后本地计数，见 ChatSurface） */
  readonly queuedCount?: number;
  /** 审批挂起时点击状态行唤回审批弹窗（提供时 waiting 升级为可点胶囊） */
  readonly onWaitingClick?: () => void;
  /** waiting 态文字覆盖（纯提问挂起传「等待作答」；缺省「正在审批」） */
  readonly waitingLabel?: string;
  /** thinking 态思考累计字符数（reasoning 心跳；显示「约 N 字」活性附注） */
  readonly thinkingChars?: number;
}

/** 字符数 → 千位近似文案（1234 → 约 1.2 千字；>=10000 → 约 1.2 万字） */
function thinkingCharsHint(chars: number | undefined): string | undefined {
  if (chars === undefined || chars < 200) return undefined;
  if (chars >= 10_000) {
    const wan = chars / 10_000;
    return `已推演约 ${wan >= 10 ? Math.round(wan) : wan.toFixed(1)} 万字`;
  }
  const qian = chars / 1000;
  return `已推演约 ${qian >= 10 ? Math.round(qian) : qian.toFixed(1)} 千字`;
}

export function GenStatus({
  phase,
  error,
  onRetry,
  queuedCount,
  onWaitingClick,
  waitingLabel,
  thinkingChars,
}: GenStatusProps) {
  const live = phase === "generating" || phase === "thinking";
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // 计时：live（thinking/generating）时每秒刷新"秒数"，离开 live 复位为 0。
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
      <RuntimeStatusIndicator
        state={phase}
        seconds={live ? elapsed : undefined}
        label={phase === "waiting" ? waitingLabel : undefined}
        thinkingHint={phase === "thinking" ? thinkingCharsHint(thinkingChars) : undefined}
      />
      {queuedCount !== undefined && queuedCount > 0 ? (
        <span className={styles.queued}>· 排队中 {queuedCount} 条</span>
      ) : null}
    </div>
  );
}
