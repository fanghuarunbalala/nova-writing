/**
 * ScheduleAbandonedNote
 *
 * 阻塞/废弃注记。
 */
import styles from "./ScheduleAbandonedNote.module.css";

export interface ScheduleAbandonedNoteProps {
  readonly kind: "blocked" | "abandoned";
  readonly reason: string;
}

export function ScheduleAbandonedNote({ kind, reason }: ScheduleAbandonedNoteProps) {
  return (
    <span className={[styles.note, styles[kind]].filter(Boolean).join(" ")}>
      {kind === "blocked" ? "阻塞" : "已废弃"}：{reason}
    </span>
  );
}
