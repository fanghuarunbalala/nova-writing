/**
 * TodoSection
 *
 * 紧凑待办 section（schedule 域）。
 */
import { ScheduleTodoList } from "../../../domains/schedule/components/ScheduleTodoList.js";
import { useScheduleTodos } from "../../../domains/schedule/hooks/useScheduleTodos.js";
import type { ScheduleStore } from "../../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../../domains/schedule/store/ScheduleTodoStore.js";

export interface TodoSectionProps {
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly onAction?: (id: string, action: string) => void;
}

export function TodoSection({ schedule, scheduleTodo, onAction }: TodoSectionProps) {
  const todos = useScheduleTodos(schedule, scheduleTodo);
  return <ScheduleTodoList todos={todos.todos} onToggle={todos.onToggle} onAction={onAction} />;
}
