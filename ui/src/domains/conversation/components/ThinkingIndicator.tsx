/**
 * ThinkingIndicator
 *
 * 思考进行中的轻量指示（替代思考块）：旋转的图表图标 + 「思考中」渐变文字。
 * 只在流式思考期间渲染（streaming && 有思考行），完成后消失，思考内容不再展示。
 * 渐变文字复用 TopBar .wordmark 技法（background-clip:text + grad-flow）。
 */
import { ChartPie } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./ThinkingIndicator.module.css";

export function ThinkingIndicator() {
  return (
    <div className={styles.indicator} role="status">
      <span className={styles.chart}>
        <Icon icon={ChartPie} size="sm" />
      </span>
      <span className={styles.label}>思考中</span>
    </div>
  );
}
