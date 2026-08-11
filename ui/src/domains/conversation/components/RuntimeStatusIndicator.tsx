/**
 * RuntimeStatusIndicator
 *
 * 三态统一状态指示（思考中/正在生成/等待审批）：[图标动效] [渐变流动文字] [可选秒数]。
 * 颜色/图标/动画按 state 区分，但共用同一套语言：
 * - thinking   大脑 + info 蓝渐变 + 轻柔呼吸（无线框）
 * - generating 笔尖 + 品牌渐变（--grad-accent）+ 上下浮动 + 墨滴下落
 * - waiting    沙漏 + warn 琥珀渐变 + 左右摇摆
 * 文字渐变复用全局 grad-flow keyframe；GenStatus 与消息流 ThinkingIndicator 共用。
 */
import { Brain, Feather, Hourglass, type LucideIcon } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./RuntimeStatusIndicator.module.css";

export type RuntimeStatusState = "thinking" | "generating" | "waiting";

export interface RuntimeStatusIndicatorProps {
  readonly state: RuntimeStatusState;
  /** 提供时显示 `Ns`（如 12s）。 */
  readonly seconds?: number;
}

const LABEL: Record<RuntimeStatusState, string> = {
  thinking: "思考中",
  generating: "正在生成",
  waiting: "等待审批",
};

const STATE_ICON: Record<RuntimeStatusState, LucideIcon> = {
  thinking: Brain,
  generating: Feather,
  waiting: Hourglass,
};

export function RuntimeStatusIndicator({
  state,
  seconds,
}: RuntimeStatusIndicatorProps) {
  const IconComponent = STATE_ICON[state];
  return (
    <div className={[styles.row, styles[state]].join(" ")} role="status">
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
