/**
 * StoryOutlineTreeRow
 *
 * 大纲树行：缩进 + 展开箭头 + 标题 + 状态 + 阻塞/废弃注记。
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
  return (
    <div className={styles.rowGroup}>
      <div
        className={[styles.row, selected ? styles.selected : ""].filter(Boolean).join(" ")}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
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
      {unit.blockedReason !== undefined || unit.abandonedReason !== undefined ? (
        <div style={{ paddingLeft: `${34 + depth * 16}px` }}>
          <OutlineBlockNote
            kind={unit.realNode === "blocked" ? "blocked" : "abandoned"}
            reason={unit.blockedReason ?? unit.abandonedReason ?? ""}
          />
        </div>
      ) : null}
    </div>
  );
}
