/**
 * StoryOutlineTree
 *
 * 大纲树容器：递归渲染行 + 底部图例。
 */
import type { StoryOutlineTreeNode } from "../projection/StoryOutlineTreeProjection.js";
import { StoryOutlineTreeLegend } from "./StoryOutlineTreeLegend.js";
import { StoryOutlineTreeRow } from "./StoryOutlineTreeRow.js";
import styles from "./StoryOutlineTree.module.css";

export interface StoryOutlineTreeProps {
  readonly workspaceId: string;
  readonly tree: readonly StoryOutlineTreeNode[];
  readonly expansionState: ReadonlyMap<string, boolean>;
  readonly selectedUnitId?: string;
  readonly onSelectUnit?: (unitId: string) => void;
  readonly onToggleExpand?: (unitId: string) => void;
}

function renderNode(
  node: StoryOutlineTreeNode,
  depth: number,
  props: StoryOutlineTreeProps,
) {
  const expanded = props.expansionState.get(node.unitId) ?? false;
  return (
    <div key={node.unitId}>
      <StoryOutlineTreeRow
        unit={node}
        depth={depth}
        expanded={expanded}
        selected={props.selectedUnitId === node.unitId}
        onSelect={() => props.onSelectUnit?.(node.unitId)}
        onToggleExpand={() => props.onToggleExpand?.(node.unitId)}
      />
      {expanded
        ? node.children.map((child) => renderNode(child, depth + 1, props))
        : null}
    </div>
  );
}

export function StoryOutlineTree(props: StoryOutlineTreeProps) {
  return (
    <div className={styles.tree} data-workspace={props.workspaceId}>
      {props.tree.map((node) => renderNode(node, 0, props))}
      <StoryOutlineTreeLegend />
    </div>
  );
}
