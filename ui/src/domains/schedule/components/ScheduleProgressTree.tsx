/**
 * ScheduleProgressTree
 *
 * 进度树容器（按 depth 缩进渲染）。
 */
import type { ScheduleProgressUnitData } from "../projection/ScheduleProjection.js";
import { ScheduleProgressUnit } from "./ScheduleProgressUnit.js";
import styles from "./ScheduleProgressTree.module.css";

export interface ScheduleProgressTreeProps {
  readonly tree: readonly ScheduleProgressUnitData[];
}

export function ScheduleProgressTree({ tree }: ScheduleProgressTreeProps) {
  return (
    <div className={styles.tree}>
      {tree.map((unit) => (
        <ScheduleProgressUnit key={unit.unitId} unit={unit} />
      ))}
    </div>
  );
}
