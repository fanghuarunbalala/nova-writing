/**
 * ScheduleAbandonedNote
 *
 * 阻塞/废弃注记（原型 .block-note / .abandoned-note）。
 *
 * 作为 unit 的兄弟元素渲染，缩进对齐父单元（depth 决定 margin-left）。
 */
import styles from "./ScheduleAbandonedNote.module.css";

export interface ScheduleAbandonedNoteProps {
  readonly kind: "blocked" | "abandoned";
  readonly reason: string;
  readonly depth?: number;
}

export function ScheduleAbandonedNote({ kind, reason, depth = 0 }: ScheduleAbandonedNoteProps) {
  const indent = depth <= 1 ? 18 : 38;
  const prefix = kind === "blocked" ? "阻塞原因：" : "已搁置：";
  return (
    <div
      className={[styles.note, kind === "blocked" ? styles.blocked : styles.abandoned].filter(Boolean).join(" ")}
      style={{ marginLeft: `${indent}px` }}
    >
      {prefix}{reason}
    </div>
  );
}
