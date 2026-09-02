/**
 * StoryOutlineTreeLegend
 *
 * 大纲树图例（原型 .tree-legend）：层级说明行 + 规划轴 3 chip + 实现轴 5 chip。
 */
import { StatusChip } from "../../../../shared/primitives/index.js";
import { PLAN_STATUS, REAL_STATUS } from "../outlineStatus.js";
import styles from "./StoryOutlineTreeLegend.module.css";

const REAL_ORDER = ["pending", "in-progress", "completed", "blocked", "abandoned"] as const;
const PLAN_ORDER = ["idea", "outlined", "ready"] as const;

export function StoryOutlineTreeLegend() {
  return (
    <div className={styles.legend}>
      <span className={styles.line}>全书 → 幕（一、/ 1.1 / 1.1.1，最多 4 层）→ 场景（最底层，正文挂场景）</span>
      <span className={styles.lbl}>规划</span>
      {PLAN_ORDER.map((key) => (
        <StatusChip key={key} variant={PLAN_STATUS[key].variant}>
          {PLAN_STATUS[key].label}
        </StatusChip>
      ))}
      <span className={styles.lbl}>实现</span>
      {REAL_ORDER.map((key) => (
        <StatusChip key={key} variant={REAL_STATUS[key].variant}>
          {REAL_STATUS[key].label}
        </StatusChip>
      ))}
    </div>
  );
}
