/**
 * StoryOutlineTreeRow
 *
 * 大纲树行（原型 .unit）：caret + label + u-scope + u-status。
 *
 * 缩进与字重由 data-depth 属性驱动（CSS 规则 per depth），depth 1/2 带左侧
 * 引导线。阻塞/废弃原因作为兄弟 OutlineBlockNote 渲染，缩进对齐父单元。
 */
import { Icon } from "../../../../shared/primitives/Icon.js";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StoryOutlineTreeNode } from "../projection/StoryOutlineTreeProjection.js";
import { OutlineBlockNote } from "./OutlineBlockNote.js";
import { StoryOutlineTreeStatus } from "./StoryOutlineTreeStatus.js";
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
  const noteKind = unit.realNode === "blocked" ? "blocked" : "abandoned";
  const noteReason = unit.blockedReason ?? unit.abandonedReason;
  return (
    <div className={styles.rowGroup}>
      <div
        className={[styles.row, selected ? styles.selected : ""].filter(Boolean).join(" ")}
        data-depth={depth}
        data-expanded={expanded ? "true" : "false"}
      >
        <button
          type="button"
          className={styles.caret}
          onClick={onToggleExpand}
          disabled={!hasChildren}
          aria-label={hasChildren ? (expanded ? "折叠" : "展开") : undefined}
        >
          {hasChildren ? (
            <Icon icon={expanded ? ChevronDown : ChevronRight} size="sm" />
          ) : (
            <span className={styles.caretSpacer} />
          )}
        </button>
        <button type="button" className={styles.main} onClick={onSelect}>
          <span className={styles.label}>{unit.label}</span>
          <span className={styles.scope}>{unit.scope}</span>
        </button>
        <StoryOutlineTreeStatus planM={unit.planM} realNode={unit.realNode} />
      </div>
      {noteReason !== undefined ? (
        <OutlineBlockNote kind={noteKind} reason={noteReason} depth={depth} />
      ) : null}
    </div>
  );
}
