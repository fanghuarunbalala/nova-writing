/**
 * OutlineBlockNote
 *
 * 阻塞/废弃原因说明（原型 .block-note / .abandoned-note）。
 *
 * 作为 row 的兄弟元素渲染，缩进对齐父单元（depth 决定 margin-left）。
 */
import styles from "./OutlineBlockNote.module.css";

export interface OutlineBlockNoteProps {
  readonly kind: "blocked" | "abandoned";
  readonly reason: string;
  readonly depth?: number;
}

export function OutlineBlockNote({ kind, reason, depth = 0 }: OutlineBlockNoteProps) {
  const indent = depth <= 1 ? 18 : 38;
  const prefix = kind === "blocked" ? "阻塞：" : "已废弃：";
  return (
    <div
      className={[styles.note, kind === "blocked" ? styles.blocked : styles.abandoned].filter(Boolean).join(" ")}
      style={{ marginLeft: `${indent}px` }}
    >
      {prefix}{reason}
    </div>
  );
}
