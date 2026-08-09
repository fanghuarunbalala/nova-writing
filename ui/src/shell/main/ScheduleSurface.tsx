/**
 * ScheduleSurface
 *
 * 计划视图：sub-head + stats + 双轴 + 待办 + 进度树。
 * 内容区用 .paneBody + .paneInner 包裹（原型 .pane-body + .pane-inner）。
 */
import { useMemo } from "react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import type { ApprovalStore } from "../../domains/approval/ApprovalStore.js";
import { ScheduleProjection } from "../../domains/schedule/projection/ScheduleProjection.js";
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
  /** 审批待办数据源（shell 级 ApprovalStore，api.conversations.listApprovals()）。 */
  readonly approvalStore: ApprovalStore;
  readonly onTodoAction?: (id: string, action: string) => void;
  readonly onBack?: () => void;
}

export function ScheduleSurface({
  schedule,
  scheduleTodo,
  approvalStore,
  onTodoAction,
  onBack,
}: ScheduleSurfaceProps) {
  const overview = useScheduleOverview(schedule);
  const todos = useScheduleTodos(schedule, scheduleTodo);
  const progress = useScheduleProgress(schedule);
  const approvalSnapshot = useExternalStore(approvalStore);
  const approvalTodos = useMemo(
    () => ScheduleProjection.deriveApprovalTodos(approvalSnapshot.approvals),
    [approvalSnapshot.approvals],
  );
  // 审批待办在前，档案/写作类在后。
  const mergedTodos = useMemo(
    () => Object.freeze([...approvalTodos, ...todos.todos]),
    [approvalTodos, todos.todos],
  );
  return (
    <div className={styles.surface}>
      <MainSubHead title="创作计划" sub="待办 + 大纲进度 · 规划 / 实现双状态轴" onBack={onBack} />
      <div className={styles.paneBody}>
        <div className={styles.paneInner}>
          <ScheduleStatRow stats={overview.stats} />
          <ScheduleAxisFlow planAxis={overview.axisFlow.planAxis} realAxis={overview.axisFlow.realAxis} />
          <ScheduleProgressCard title="大纲进度">
            <ScheduleProgressTree tree={progress.tree} />
          </ScheduleProgressCard>
          <ScheduleTodoList
            todos={mergedTodos}
            onToggle={todos.onToggle}
            onAction={onTodoAction}
          />
        </div>
      </div>
    </div>
  );
}
