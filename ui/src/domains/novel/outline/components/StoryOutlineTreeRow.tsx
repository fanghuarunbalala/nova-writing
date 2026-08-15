/**
 * StoryOutlineTreeRow
 *
 * 大纲树行（原型 .treeRow）：chev（父）/ 短横线 tick（叶）+ 标题 +
 * scope chip（仅父）+ 进度数字 + 实现状态 chip。
 *
 * 缩进与字重由 data-depth 属性驱动（CSS 规则 per depth），depth 1/2 带左侧
 * 引导线。阻塞/废弃原因作为兄弟 OutlineBlockNote 渲染，缩进对齐父单元。
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { Icon, StatusChip } from "../../../../shared/primitives/index.js";
import type { StoryOutlineTreeNode } from "../projection/StoryOutlineTreeProjection.js";
import { REAL_STATUS, SCOPE_TYPE } from "../outlineStatus.js";
import { OutlineBlockNote } from "./OutlineBlockNote.js";
import styles from "./StoryOutlineTreeRow.module.css";

export interface StoryOutlineTreeRowProps {
  readonly unit: StoryOutlineTreeNode;
  readonly depth: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggleExpand: () => void;
}

export function StoryOutlineTreeRow({
  unit,
  depth,
  expanded,
  selected,
  onSelect,
  onToggleExpand,
}: StoryOutlineTreeRowProps) {
  const hasChildren = unit.children.length > 0;
  const real = REAL_STATUS[unit.realization];
  // 受阻/废弃行不给进度数字（原型口径：状态本身说明问题）。
  const showProgress =
    unit.progress !== undefined && unit.realization !== "blocked" && unit.realization !== "abandoned";
  const noteReason = unit.blockedReason ?? unit.abandonedReason;
  return (
    <div className={styles.rowGroup}>
      <div
        className={[styles.row, selected ? styles.selected : ""].filter(Boolean).join(" ")}
        data-depth={depth}
        data-expanded={expanded ? "true" : "false"}
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
          title={`${unit.title} · ${unit.scope}`}
        >
          <span className={styles.label}>{unit.title}</span>
        </button>
        {hasChildren ? (
          <StatusChip variant={SCOPE_TYPE[unit.scope].variant} compact title={unit.scope}>
            {SCOPE_TYPE[unit.scope].label}
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
      {noteReason !== undefined ? (
        <OutlineBlockNote
          kind={unit.realization === "blocked" ? "blocked" : "abandoned"}
          reason={noteReason}
          depth={depth}
        />
      ) : null}
    </div>
  );
}
