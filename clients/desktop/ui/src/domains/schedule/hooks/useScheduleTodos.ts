/**
 * useScheduleTodos
 *
 * 订阅 schedule todos 并叠加本地完成态（ScheduleTodoStore.toggle）。
 */
import { useCallback, useMemo } from "react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ScheduleStore } from "../store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../store/ScheduleTodoStore.js";

export function useScheduleTodos(store: ScheduleStore, todoStore: ScheduleTodoStore) {
  const snapshot = useExternalStore(store);
  const todoState = useExternalStore(todoStore).todoState;
  const onToggle = useCallback((id: string) => todoStore.toggle(id), [todoStore]);
  return useMemo(
    () =>
      Object.freeze({
        todos: snapshot.todos.map((todo) => ({
          ...todo,
          status: todoState.get(todo.id) ?? todo.status,
        })),
        onToggle,
      }),
    [onToggle, snapshot.todos, todoState],
  );
}
