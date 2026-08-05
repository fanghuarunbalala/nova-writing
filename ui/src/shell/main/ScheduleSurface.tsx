/**
 * ScheduleSurface
 *
 * 计划视图：stats + 双轴 + 待办 + 进度树。
 */
import { ScheduleAxisFlow } from "../../domains/schedule/components/ScheduleAxisFlow.js";
import { ScheduleProgressCard } from "../../domains/schedule/components/ScheduleProgressCard.js";
import { ScheduleProgressTree } from "../../domains/schedule/components/ScheduleProgressTree.js";
import { ScheduleStatRow } from "../../domains/schedule/components/ScheduleStatRow.js";
import { ScheduleTodoList } from "../../domains/schedule/components/ScheduleTodoList.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import { useScheduleOverview } from "../../domains/schedule/hooks/useScheduleOverview.js";
import { useScheduleProgress } from "../../domains/schedule/hooks/useScheduleProgress.js";
import { useScheduleTodos } from "../../domains/schedule/hooks/useScheduleTodos.js";
import styles from "./ScheduleSurface.module.css";

export interface ScheduleSurfaceProps {
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly onTodoAction?: (id: string, action: string) => void;
}

export function ScheduleSurface({ schedule, scheduleTodo, onTodoAction }: ScheduleSurfaceProps) {
  const overview = useScheduleOverview(schedule);
  const todos = useScheduleTodos(schedule, scheduleTodo);
  const progress = useScheduleProgress(schedule);
  return (
    <div className={styles.surface}>
      <ScheduleStatRow stats={overview.stats} />
      <ScheduleAxisFlow planAxis={overview.axisFlow.planAxis} realAxis={overview.axisFlow.realAxis} />
      <ScheduleProgressCard title="大纲进度">
        <ScheduleProgressTree tree={progress.tree} />
      </ScheduleProgressCard>
      <ScheduleTodoList
        todos={todos.todos}
        onToggle={todos.onToggle}
        onAction={onTodoAction}
      />
    </div>
  );
}
