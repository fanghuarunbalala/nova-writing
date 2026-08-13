/**
 * ScheduleStat
 *
 * 单个统计项：大数字 + label + note。
 */
import type { ScheduleStatData } from "../projection/ScheduleProjection.js";
import styles from "./ScheduleStat.module.css";

export interface ScheduleStatProps {
  readonly stat: ScheduleStatData;
}

export function ScheduleStat({ stat }: ScheduleStatProps) {
  return (
    <div className={[styles.stat, stat.variant !== undefined ? styles[stat.variant] : ""].filter(Boolean).join(" ")}>
      <span className={styles.num}>{stat.num}</span>
      <span className={styles.label}>{stat.label}</span>
      <span className={styles.note}>{stat.note}</span>
    </div>
  );
}
