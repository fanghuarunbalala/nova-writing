/**
 * ScheduleStatRow
 *
 * 统计行容器。
 */
import type { ScheduleStatData } from "../projection/ScheduleProjection.js";
import { ScheduleStat } from "./ScheduleStat.js";
import styles from "./ScheduleStatRow.module.css";

export interface ScheduleStatRowProps {
  readonly stats: readonly ScheduleStatData[];
}

export function ScheduleStatRow({ stats }: ScheduleStatRowProps) {
  return (
    <div className={styles.row}>
      {stats.map((stat) => (
        <ScheduleStat key={stat.id} stat={stat} />
      ))}
    </div>
  );
}
