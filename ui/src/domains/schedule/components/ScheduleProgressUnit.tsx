/**
 * ScheduleProgressUnit
 *
 * 进度树单行。
 */
import type { ScheduleProgressUnitData } from "../projection/ScheduleProjection.js";
import { ScheduleAbandonedNote } from "./ScheduleAbandonedNote.js";
import styles from "./ScheduleProgressUnit.module.css";

export interface ScheduleProgressUnitProps {
  readonly unit: ScheduleProgressUnitData;
}

export function ScheduleProgressUnit({ unit }: ScheduleProgressUnitProps) {
  return (
    <div className={styles.unit} style={{ paddingLeft: `${10 + unit.depth * 16}px` }}>
      <span className={[styles.dot, styles[unit.realNode]].filter(Boolean).join(" ")} aria-hidden="true" />
      <span className={styles.label}>{unit.label}</span>
      {unit.progress !== undefined ? (
        <span className={styles.progress}>
          {unit.progress.completed}/{unit.progress.total}
        </span>
      ) : null}
      {unit.blockedReason !== undefined ? <ScheduleAbandonedNote kind="blocked" reason={unit.blockedReason} /> : null}
      {unit.abandonedReason !== undefined ? <ScheduleAbandonedNote kind="abandoned" reason={unit.abandonedReason} /> : null}
    </div>
  );
}
