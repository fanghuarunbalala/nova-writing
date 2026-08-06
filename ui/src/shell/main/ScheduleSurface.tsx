/**
 * ScheduleSurface
 *
 * 计划视图：sub-head + stats + 双轴 + 待办 + 进度树。
 * 内容区用 .paneBody + .paneInner 包裹（原型 .pane-body + .pane-inner）。
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
import { MainSubHead } from "./MainSubHead.js";
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
      <MainSubHead title="创作计划" sub="待办 + 大纲进度 · 规划 / 实现双状态轴" />
      <div className={styles.paneBody}>
        <div className={styles.paneInner}>
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
      </div>
    </div>
  );
}
