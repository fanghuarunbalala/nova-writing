/**
 * QueuedUserMessage
 *
 * 排队消息幽灵项（app-redesign demo .msgUser.ghost）：生成/审批进行中再发送时，
 * 消息要等上一 run 收口才实际执行（user.message 在开跑时才发射）——发送瞬间
 * 以降透明度虚线气泡即时回显在时间线末尾，左上角琥珀「排队中 Ns」角标实时跳动；
 * 真实消息上屏时由 ChatSurface 移除本项（原地语义上「晋升」）。
 * 布局对齐 UserMessage（row-reverse 贴右、同气泡形状与字号）。
 * memo 包裹：queuedAt 不变时秒表组件自身重渲染，父级零重渲染。
 */
import { memo, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./QueuedUserMessage.module.css";

export interface QueuedUserMessageProps {
  readonly text: string;
  /** 入队时刻（epoch ms；角标秒数起点） */
  readonly queuedAt: number;
}

export const QueuedUserMessage = memo(function QueuedUserMessage({
  text,
  queuedAt,
}: QueuedUserMessageProps) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - queuedAt) / 1000)));
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - queuedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [queuedAt]);

  return (
    <div className={styles.message}>
      <div className={styles.body}>
        {/* badge 必须是气泡的子元素（demo 同构）：放兄弟位置时最近定位祖先会
            跳过气泡落到 .enter 行容器（content-visibility containment 使其成为
            包含块）→ left/top 相对整行解释，角标跑到最左 */}
        <span className={styles.text}>
          <span className={styles.badge}>
            <Icon icon={Clock} size="xs" />
            排队中
            <span className={styles.seconds}>{elapsed}s</span>
          </span>
          {text}
        </span>
      </div>
    </div>
  );
});
