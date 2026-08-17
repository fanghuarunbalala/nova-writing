/**
 * QueuedUserMessage
 *
 * 发送幽灵项（乐观回显，app-redesign demo .msgUser.ghost）：所有发送瞬间以
 * 降透明度虚线气泡即时回显在时间线末尾，真实 user 项上屏时由 ChatSurface
 * 移除本项（原地语义上「晋升」）。两相位：
 * - flight（空闲发送「发送中」）：气泡左侧旋转图标动画，user.message 回流
 *   落定为实线消息即止，随后状态行接管显示「正在生成」；
 * - queued（生成/审批进行中再发送「排队中」）：消息要等上一 run 收口才实际
 *   执行（user.message 在开跑时才发射），左上角琥珀角标秒表实时跳动。
 * 布局对齐 UserMessage（row-reverse 贴右、同气泡形状与字号）。
 * memo 包裹：queuedAt 不变时秒表组件自身重渲染，父级零重渲染。
 */
import { memo, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { debugLog } from "@novel/core/client";
import { Icon } from "../../../shared/primitives/Icon.js";
import { Spinner } from "../../../shared/primitives/Spinner.js";
import styles from "./QueuedUserMessage.module.css";

export interface QueuedUserMessageProps {
  readonly text: string;
  /** 入队时刻（epoch ms；queued 角标秒数起点） */
  readonly queuedAt: number;
  /** 幽灵相位（缺省 queued，向后兼容）：flight = 空闲发送「发送中」；
   * queued = 生成/审批中再发送「排队中 Ns」。 */
  readonly phase?: "flight" | "queued";
}

export const QueuedUserMessage = memo(function QueuedUserMessage({
  text,
  queuedAt,
  phase = "queued",
}: QueuedUserMessageProps) {
  // 渲染诊断：确认幽灵以哪个形态上屏（flight = 虚线气泡 + 左侧旋转「发送中」；
  // queued = 琥珀「排队中 Ns」）。与 [ghost] enqueue 对看可定位渲染链路问题。
  useEffect(() => {
    debugLog("[ghost] render:", { phase, text: text.slice(0, 40) });
  }, [phase, text]);
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - queuedAt) / 1000)));
  useEffect(() => {
    if (phase !== "queued") return;
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - queuedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, queuedAt]);

  return (
    <div className={styles.message}>
      <div className={styles.body}>
        <span className={styles.text}>
          {/* badge 必须是气泡的子元素（demo 同构）：放兄弟位置时最近定位祖先会
              跳过气泡落到 .enter 行容器（content-visibility containment 使其成为
              包含块）→ left/top 相对整行解释，角标跑到最左 */}
          {phase === "flight" ? (
            <span className={[styles.badge, styles.badgeFlight].filter(Boolean).join(" ")}>
              发送中
            </span>
          ) : (
            <span className={styles.badge}>
              <Icon icon={Clock} size="xs" />
              排队中
              <span className={styles.seconds}>{elapsed}s</span>
            </span>
          )}
          {text}
        </span>
      </div>
      {/* flight：气泡左侧旋转图标（row-reverse 布局下 DOM 末位即视觉左侧） */}
      {phase === "flight" ? (
        <span className={styles.flightSpin} aria-hidden="true">
          <Spinner size="sm" />
        </span>
      ) : null}
    </div>
  );
});
