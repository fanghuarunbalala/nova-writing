/**
 * RuntimeStatusIndicator
 *
 * 状态指示统一语言（深度思考中/正在生成/正在审批）：[图标动效] [渐变流动文字] [可选秒数]。
 * 颜色/图标/动画按 state 区分，但共用同一套语言：
 * - thinking   脑形 + info 蓝渐变 + 呼吸（reasoning 心跳驱动，thinkingHint 可带「约 N 字」）
 * - generating 笔尖 + 品牌渐变（--grad-accent）+ 上下浮动 + 墨滴下落
 * - waiting    沙漏 + warn 琥珀渐变 + 左右摇摆
 * 文字渐变复用全局 grad-flow keyframe；GenStatus 专用。
 */
import { Brain, Feather, Hourglass, type LucideIcon } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./RuntimeStatusIndicator.module.css";

export type RuntimeStatusState = "thinking" | "generating" | "waiting";

export interface RuntimeStatusIndicatorProps {
  readonly state: RuntimeStatusState;
  /** 提供时显示 `Ns`（如 12s）。 */
  readonly seconds?: number;
  /** 覆盖状态文字（如纯提问挂起传「等待作答」；缺省按 state 取「正在审批」）。 */
  readonly label?: string;
  /** thinking 态附注（reasoning 心跳累计字符数换算的「约 N 字」；其他态忽略）。 */
  readonly thinkingHint?: string;
}

const LABEL: Record<RuntimeStatusState, string> = {
  thinking: "深度思考中",
  generating: "正在生成",
  waiting: "正在审批",
};

const STATE_ICON: Record<RuntimeStatusState, LucideIcon> = {
  thinking: Brain,
  generating: Feather,
  waiting: Hourglass,
};

export function RuntimeStatusIndicator({
  state,
  seconds,
  label,
  thinkingHint,
}: RuntimeStatusIndicatorProps) {
  const IconComponent = STATE_ICON[state];
  return (
    // 语义 role 由宿主 GenStatus 容器声明（避免嵌套 live region 重复播报）
    <div className={[styles.row, styles[state]].join(" ")}>
      <span className={styles.icon}>
        <Icon icon={IconComponent} size="sm" />
        {state === "generating" ? (
          <span className={styles.ink} aria-hidden="true" />
        ) : null}
      </span>
      <span className={styles.label}>{label ?? LABEL[state]}</span>
      {state === "thinking" && thinkingHint !== undefined ? (
        <span className={styles.hint}>· {thinkingHint}</span>
      ) : null}
      {seconds !== undefined ? (
        <span className={styles.seconds}>{seconds}s</span>
      ) : null}
    </div>
  );
}
