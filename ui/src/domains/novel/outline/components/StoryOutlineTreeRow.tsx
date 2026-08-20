/**
 * StoryOutlineTreeRow
 *
 * 大纲树行（原型 .treeRow）：chev（父）/ 短横线 tick（叶）+ 标题 +
 * scope chip（仅父）+ 进度数字 + 实现状态 chip。
 *
 * 缩进与字重由 data-depth 属性驱动（CSS 规则 per depth），depth 1/2 带左侧
 * 引导线。阻塞/废弃原因不在树行显示（SB-7 口径），由单元详情页横幅承载。
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DragEvent } from "react";
import { Icon, StatusChip } from "../../../../shared/primitives/index.js";
import type { StoryOutlineTreeNode } from "../projection/StoryOutlineTreeProjection.js";
import { ordinalLabel } from "../projection/StoryOutlineTreeProjection.js";
import { REAL_STATUS, SCOPE_TYPE } from "../outlineStatus.js";
import styles from "./StoryOutlineTreeRow.module.css";

export interface StoryOutlineTreeRowProps {
  readonly unit: StoryOutlineTreeNode;
  readonly depth: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggleExpand: () => void;
  /** 可拖（拖入对话输入框作引用；右栏目录开启） */
  readonly draggable?: boolean;
  /** 拖拽开始（宿主写入引用载荷） */
  readonly onDragStart?: (event: DragEvent<HTMLElement>) => void;
}

export function StoryOutlineTreeRow({
  unit,
  depth,
  expanded,
  selected,
  onSelect,
  onToggleExpand,
  draggable = false,
  onDragStart,
}: StoryOutlineTreeRowProps) {
  const hasChildren = unit.children.length > 0;
  const real = REAL_STATUS[unit.realization];
  // 受阻/废弃行不给进度数字（原型口径：状态本身说明问题）。
  const showProgress =
    unit.progress !== undefined && unit.realization !== "blocked" && unit.realization !== "abandoned";
  return (
    <div
      className={[styles.row, selected ? styles.selected : ""].filter(Boolean).join(" ")}
      data-depth={depth}
      data-expanded={expanded ? "true" : "false"}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {hasChildren ? (
        <button
          type="button"
          className={styles.caret}
          onClick={onToggleExpand}
          aria-label={expanded ? "折叠" : "展开"}
        >
          <Icon icon={expanded ? ChevronDown : ChevronRight} size="sm" />
        </button>
      ) : (
        <span className={styles.tick} aria-hidden="true" />
      )}
      <button
        type="button"
        className={styles.main}
        onClick={onSelect}
        title={unit.title}
      >
        <span className={styles.label}>{`${ordinalLabel(unit.ordinal)}${unit.title}`}</span>
      </button>
      {hasChildren ? (
        <StatusChip variant={SCOPE_TYPE[unit.scope].variant} compact title={SCOPE_TYPE[unit.scope].label}>
          {SCOPE_TYPE[unit.scope].label}
        </StatusChip>
      ) : null}
      {unit.overDepth ? (
        <StatusChip variant="danger" compact title="层级超过 4 层（全书 → 幕 → 幕 → 场景），建议整理">
          超深
        </StatusChip>
      ) : null}
      {showProgress ? (
        <span className={styles.miniNum}>
          {unit.progress!.completed}/{unit.progress!.total}
        </span>
      ) : null}
      <StatusChip variant={real.variant} title={unit.realization}>
        {real.label}
      </StatusChip>
    </div>
  );
}
