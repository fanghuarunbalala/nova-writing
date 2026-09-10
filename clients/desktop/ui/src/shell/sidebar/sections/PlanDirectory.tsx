/**
 * PlanDirectory
 *
 * 计划视图「安排」目录（PRD SB-10）：总览行 + 按标签分组待办
 * （审批/档案/写作/决策，审批组带 warn 计数）+ 已完成组 + 「自动化」占位组。
 * 审批组常驻渲染（空时轻提示「暂无待审批」），其余标签组空则隐藏；
 * 自动化为路线图占位（定时任务未实现，UI 骨架先行）。
 * 待办数据 = shell 级审批投影（deriveApprovalTodos）+ 计划域待办（同 ScheduleSurface 合并规则）。
 */
import { memo, useMemo } from "react";
import { Check, GitBranch, Layers, PenLine, ShieldCheck, UserRound, Zap, type LucideIcon } from "lucide-react";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ApprovalStore } from "../../../domains/approval/ApprovalStore.js";
import { ScheduleProjection } from "../../../domains/schedule/projection/ScheduleProjection.js";
import type { ScheduleStore } from "../../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../../domains/schedule/store/ScheduleTodoStore.js";
import { useScheduleTodos } from "../../../domains/schedule/hooks/useScheduleTodos.js";
import type { ScheduleTodoData } from "../../../domains/schedule/projection/ScheduleProjection.js";
import styles from "./directory.module.css";

type TodoTag = ScheduleTodoData["tag"];

const TAG_META: Record<TodoTag, { readonly label: string; readonly icon: LucideIcon }> = {
  approval: { label: "待审批", icon: ShieldCheck },
  profile: { label: "档案", icon: UserRound },
  writing: { label: "写作", icon: PenLine },
  decision: { label: "决策", icon: GitBranch },
};

const TAG_ORDER: readonly TodoTag[] = ["approval", "profile", "writing", "decision"];

export interface PlanDirectoryProps {
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly approvalStore: ApprovalStore;
  /** 当前选中待办（null = 总览） */
  readonly selectedTodoId: string | null;
  readonly onSelect: (id: string | null) => void;
}

export const PlanDirectory = memo(function PlanDirectory({
  schedule,
  scheduleTodo,
  approvalStore,
  selectedTodoId,
  onSelect,
}: PlanDirectoryProps) {
  const todos = useScheduleTodos(schedule, scheduleTodo);
  const approvalSnapshot = useExternalStore(approvalStore);
  const merged = useMemo(() => {
    const approvalTodos = ScheduleProjection.deriveApprovalTodos(approvalSnapshot.approvals);
    return [...approvalTodos, ...todos.todos] as readonly ScheduleTodoData[];
  }, [approvalSnapshot.approvals, todos.todos]);

  const open = useMemo(() => merged.filter((t) => t.status === "open"), [merged]);
  const done = useMemo(() => merged.filter((t) => t.status === "done"), [merged]);

  return (
    <div className={styles.directory}>
      <button
        type="button"
        className={styles.row}
        data-active={selectedTodoId === null || undefined}
        onClick={() => onSelect(null)}
      >
        <span className={styles.iconBox}>
          <Icon icon={Layers} size="xs" />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>总览</span>
          <span className={styles.subtitle}>统计 · 双状态轴 · 大纲进度</span>
        </span>
      </button>
      {TAG_ORDER.map((tag) => {
        const items = open.filter((t) => t.tag === tag);
        // 审批组常驻（入口可感知，空时轻提示）；其余标签组空则隐藏
        if (items.length === 0 && tag !== "approval") return null;
        const warn = tag === "approval";
        return (
          <div key={tag}>
            <div className={styles.groupHead} style={warn ? { color: "var(--color-warn)" } : undefined}>
              {warn ? (
                <span
                  aria-hidden="true"
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "var(--color-warn)",
                    flex: "none",
                  }}
                />
              ) : null}
              {TAG_META[tag].label}
              <span className={styles.count}>{items.length}</span>
            </div>
            {items.length > 0 ? (
              items.map((todo) => (
                <button
                  key={todo.id}
                  type="button"
                  className={styles.row}
                  data-active={todo.id === selectedTodoId || undefined}
                  onClick={() => onSelect(todo.id)}
                >
                  <span className={styles.todoDot} aria-hidden="true" />
                  <span className={styles.text}>
                    <span className={styles.title}>{todo.title}</span>
                  </span>
                  <Icon icon={TAG_META[todo.tag].icon} size="xs" />
                </button>
              ))
            ) : (
              <div className={styles.groupEmpty}>暂无待审批</div>
            )}
          </div>
        );
      })}
      {/* 自动化（占位）：定时自动化编排（README 路线图）尚未实现，UI 骨架先行 */}
      <div>
        <div className={styles.groupHead}>
          <Icon icon={Zap} size="xs" />
          自动化
        </div>
        <div className={styles.groupEmpty}>定时自动化编排 · 规划中</div>
      </div>
      {done.length > 0 ? (
        <div>
          <div className={styles.groupHead}>
            已完成
            <span className={styles.count}>{done.length}</span>
          </div>
          {done.map((todo) => (
            <button
              key={todo.id}
              type="button"
              className={styles.row}
              data-active={todo.id === selectedTodoId || undefined}
              data-done="true"
              onClick={() => onSelect(todo.id)}
            >
              <span className={styles.todoDot} aria-hidden="true">
                <Icon icon={Check} size="xs" />
              </span>
              <span className={styles.text}>
                <span className={styles.title}>{todo.title}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});
