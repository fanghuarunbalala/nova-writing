/**
 * ScheduleTodoStore
 *
 * 待办完成态的本地 store（是否勾选），与派生 todos 合并展示。
 */
import { ExternalStore } from "../../../shared/state/ExternalStore.js";

export interface ScheduleTodoSnapshot {
  readonly todoState: ReadonlyMap<string, "open" | "done">;
}

export class ScheduleTodoStore extends ExternalStore<ScheduleTodoSnapshot> {
  constructor() {
    super({ todoState: new Map<string, "open" | "done">() });
  }

  toggle(id: string): void {
    const todoState = new Map(this.snapshot.todoState);
    todoState.set(id, todoState.get(id) === "done" ? "open" : "done");
    this.setSnapshot({ todoState });
  }
}
