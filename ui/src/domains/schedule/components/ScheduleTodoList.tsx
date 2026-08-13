/**
 * ScheduleTodoList
 *
 * 待办列表容器。
 */
import type { ScheduleTodoData } from "../projection/ScheduleProjection.js";
import { ScheduleTodoItem } from "./ScheduleTodoItem.js";
import styles from "./ScheduleTodoList.module.css";

export interface ScheduleTodoListProps {
  readonly todos: readonly ScheduleTodoData[];
  readonly onToggle?: (id: string) => void;
  readonly onAction?: (id: string, action: string) => void;
}

export function ScheduleTodoList({ todos, onToggle, onAction }: ScheduleTodoListProps) {
  if (todos.length === 0) {
    return <div className={styles.empty}>今天没有待办</div>;
  }
  return (
    <div className={styles.list}>
      {todos.map((todo) => (
        <ScheduleTodoItem
          key={todo.id}
          todo={todo}
          onToggle={() => onToggle?.(todo.id)}
          onAction={(action) => onAction?.(todo.id, action)}
        />
      ))}
    </div>
  );
}
