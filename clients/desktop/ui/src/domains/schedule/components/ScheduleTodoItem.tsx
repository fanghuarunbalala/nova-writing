/**
 * ScheduleTodoItem
 *
 * 待办项（原型 .todo）：勾选框 + 标题 + meta（含可选动作链接）+ 右侧 ttag。
 *
 * check 用 appearance:none 的 checkbox，未选 1.5px 描边方框，选中后 success 底
 * + bg 色 ✓。ttag 按 decision/approval/profile/writing 四色映射。
 */
import { Check } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ScheduleTodoData } from "../projection/ScheduleProjection.js";
import styles from "./ScheduleTodoItem.module.css";

export interface ScheduleTodoItemProps {
  readonly todo: ScheduleTodoData;
  readonly onToggle?: () => void;
  readonly onAction?: (action: string) => void;
}

const TAG_LABEL: Record<ScheduleTodoData["tag"], string> = {
  decision: "决策",
  approval: "审批",
  profile: "档案",
  writing: "写作",
};

const TAG_CLASS: Record<ScheduleTodoData["tag"], string> = {
  decision: styles.tagDecision!,
  approval: styles.tagApproval!,
  profile: styles.tagProfile!,
  writing: styles.tagWriting!,
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
        <span className={styles.checkMark} aria-hidden="true">
          <Icon icon={Check} size="xs" strokeWidth={2.6} />
        </span>
      </label>
      <div className={styles.body}>
        <div className={styles.title}>{todo.title}</div>
        <div className={styles.meta}>
          <span>{todo.meta}</span>
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
      </div>
      <span className={[styles.ttag, TAG_CLASS[todo.tag]].filter(Boolean).join(" ")}>
        {TAG_LABEL[todo.tag]}
      </span>
    </div>
  );
}
