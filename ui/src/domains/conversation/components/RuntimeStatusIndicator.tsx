/**
 * RuntimeStatusIndicator
 *
 * 状态指示统一语言（正在生成/正在审批）：[图标动效] [渐变流动文字] [可选秒数]。
 * 颜色/图标/动画按 state 区分，但共用同一套语言：
 * - generating 笔尖 + 品牌渐变（--grad-accent）+ 上下浮动 + 墨滴下落
 * - waiting    沙漏 + warn 琥珀渐变 + 左右摇摆
 * thinking 态已随 loop 层丢弃 reasoning delta 移除（呼吸动效一并减载）。
 * 文字渐变复用全局 grad-flow keyframe；GenStatus 专用。
 */
import { Feather, Hourglass, type LucideIcon } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./RuntimeStatusIndicator.module.css";

export type RuntimeStatusState = "generating" | "waiting";

export interface RuntimeStatusIndicatorProps {
  readonly state: RuntimeStatusState;
  /** 提供时显示 `Ns`（如 12s）。 */
  readonly seconds?: number;
}

const LABEL: Record<RuntimeStatusState, string> = {
  generating: "正在生成",
  waiting: "正在审批",
};

const STATE_ICON: Record<RuntimeStatusState, LucideIcon> = {
  generating: Feather,
  waiting: Hourglass,
};

export function RuntimeStatusIndicator({
  state,
  seconds,
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
      <span className={styles.label}>{LABEL[state]}</span>
      {seconds !== undefined ? (
        <span className={styles.seconds}>{seconds}s</span>
      ) : null}
    </div>
  );
}
