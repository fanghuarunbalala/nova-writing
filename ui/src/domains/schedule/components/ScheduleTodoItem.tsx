/**
 * ScheduleTodoItem
 *
 * 待办项：勾选 + 标题 + meta + tag + 可选动作。
 */
import { Pill } from "../../../shared/primitives/Pill.js";
import type { ScheduleTodoData } from "../projection/ScheduleProjection.js";
import styles from "./ScheduleTodoItem.module.css";

export interface ScheduleTodoItemProps {
  readonly todo: ScheduleTodoData;
  readonly onToggle?: () => void;
  readonly onAction?: (action: string) => void;
}

const TAG_VARIANT: Record<ScheduleTodoData["tag"], "pending" | "approved" | "changed" | "info"> = {
  decision: "pending",
  approval: "changed",
  profile: "info",
  writing: "approved",
};

export function ScheduleTodoItem({ todo, onToggle, onAction }: ScheduleTodoItemProps) {
  const done = todo.status === "done";
  return (
    <div className={[styles.item, done ? styles.done : ""].filter(Boolean).join(" ")}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggle?.()}
          aria-label={todo.title}
        />
      </label>
      <span className={styles.body}>
        <span className={styles.title}>{todo.title}</span>
        <span className={styles.meta}>
          <Pill variant={TAG_VARIANT[todo.tag]}>{todo.tag}</Pill>
          {todo.meta}
        </span>
      </span>
      {todo.action !== undefined ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => onAction?.(todo.action!.kind)}
        >
          {todo.action.label}
        </button>
      ) : null}
    </div>
  );
}
