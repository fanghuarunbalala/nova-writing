/**
 * ScheduleSurface
 *
 * 计划视图（PRD §8）：待办目录在侧栏（PlanDirectory），主区两态——
 *   总览（selectedTodoId === null）= 统计卡 + 双状态轴 + 大纲进度；
 *   待办详情 = 标签/状态 chip + 标题 + 元信息 + 跨视图动作 + 标记完成。
 * 待办数据 = 审批投影 + 计划域待办（与 PlanDirectory 同一合并规则）。
 */
import { useMemo } from "react";
import { Check, GitBranch, PenLine, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { LoadingState } from "../../shared/primitives/LoadingState.js";
import { Button } from "../../shared/primitives/Button.js";
import { Icon } from "../../shared/primitives/Icon.js";
import type { ApprovalStore } from "../../domains/approval/ApprovalStore.js";
import { ScheduleProjection, type ScheduleTodoData } from "../../domains/schedule/projection/ScheduleProjection.js";
import { ScheduleAxisFlow } from "../../domains/schedule/components/ScheduleAxisFlow.js";
import { ScheduleProgressCard } from "../../domains/schedule/components/ScheduleProgressCard.js";
import { ScheduleProgressTree } from "../../domains/schedule/components/ScheduleProgressTree.js";
import { ScheduleStatRow } from "../../domains/schedule/components/ScheduleStatRow.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import { useScheduleOverview } from "../../domains/schedule/hooks/useScheduleOverview.js";
import { useScheduleProgress } from "../../domains/schedule/hooks/useScheduleProgress.js";
import { useScheduleTodos } from "../../domains/schedule/hooks/useScheduleTodos.js";
import { MainSubHead } from "./MainSubHead.js";
import styles from "./ScheduleSurface.module.css";

const TAG_META: Record<ScheduleTodoData["tag"], { readonly label: string; readonly icon: LucideIcon }> = {
  approval: { label: "审批", icon: ShieldCheck },
  profile: { label: "档案", icon: UserRound },
  writing: { label: "写作", icon: PenLine },
  decision: { label: "决策", icon: GitBranch },
};

export interface ScheduleSurfaceProps {
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  /** 审批待办数据源（shell 级 ApprovalStore，由活动会话投影 approvals 驱动）。 */
  readonly approvalStore: ApprovalStore;
  /** 选中待办（null = 总览）；目录在侧栏 PlanDirectory。 */
  readonly selectedTodoId: string | null;
  readonly onSelectTodo: (id: string | null) => void;
  readonly onTodoAction?: (id: string, action: string) => void;
  readonly onBack?: () => void;
}

export function ScheduleSurface({
  schedule,
  scheduleTodo,
  approvalStore,
  selectedTodoId,
  onSelectTodo,
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
  // 审批待办在前，档案/写作类在后（与 PlanDirectory 一致）。
  const mergedTodos = useMemo(
    () => Object.freeze([...approvalTodos, ...todos.todos]) as readonly ScheduleTodoData[],
    [approvalTodos, todos.todos],
  );
  const selected = useMemo(
    () => mergedTodos.find((todo) => todo.id === selectedTodoId),
    [mergedTodos, selectedTodoId],
  );

  return (
    <div className={styles.surface}>
      <MainSubHead
        title={selected === undefined ? "计划 · 总览" : "计划 · 待办"}
        sub={
          selected === undefined
            ? "待办 + 大纲进度 · 规划 / 实现双状态轴"
            : selected.meta
        }
        onBack={onBack}
      />
      <div className={styles.paneBody}>
        <div className={styles.paneInner}>
          {selected !== undefined ? (
            <div className={styles.todoCard}>
              <div className={styles.todoChips}>
                <span className={styles.tagChip}>
                  <Icon icon={TAG_META[selected.tag].icon} size="xs" />
                  {TAG_META[selected.tag].label}
                </span>
                <span className={selected.status === "done" ? styles.doneChip : styles.openChip}>
                  {selected.status === "done" ? "已完成" : "待处理"}
                </span>
              </div>
              <h2 className={styles.todoTitle}>{selected.title}</h2>
              <p className={styles.todoMeta}>{selected.meta}</p>
              <div className={styles.todoActions}>
                {selected.action !== undefined ? (
                  <Button
                    variant="primary"
                    onClick={() => onTodoAction?.(selected.id, selected.action?.kind ?? "")}
                  >
                    {selected.action.label}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  leadingIcon={<Icon icon={Check} size="sm" />}
                  onClick={() => {
                    todos.onToggle(selected.id);
                    if (selected.status === "open") onSelectTodo(null);
                  }}
                >
                  {selected.status === "done" ? "标记为未完成" : "标记完成"}
                </Button>
              </div>
            </div>
          ) : overview.phase === "loading" ? (
            <LoadingState label="正在汇总创作计划…" />
          ) : (
            <>
              <ScheduleStatRow stats={overview.stats} />
              <ScheduleAxisFlow planAxis={overview.axisFlow.planAxis} realAxis={overview.axisFlow.realAxis} />
              <ScheduleProgressCard title="大纲进度">
                <ScheduleProgressTree tree={progress.tree} />
              </ScheduleProgressCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
