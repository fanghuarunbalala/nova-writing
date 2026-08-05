/**
 * OutlineBlockNote
 *
 * 阻塞/废弃原因说明。
 */
import styles from "./OutlineBlockNote.module.css";

export interface OutlineBlockNoteProps {
  readonly kind: "blocked" | "abandoned";
  readonly reason: string;
}

export function OutlineBlockNote({ kind, reason }: OutlineBlockNoteProps) {
  return (
    <div className={[styles.note, styles[kind]].filter(Boolean).join(" ")}>
      {kind === "blocked" ? "阻塞" : "已废弃"}：{reason}
    </div>
  );
}
