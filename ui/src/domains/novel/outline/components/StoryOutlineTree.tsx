/**
 * StoryOutlineTree
 *
 * 大纲树容器：递归行 + 底部图例（showLegend=false 时不渲染——右栏内容目录
 * 无图例，仅内容视图左栏保留）；展开/折叠全部在侧栏 dirHead（DirectoryHead）。
 * loading / 空树走 LoadingState / EmptyState。
 */
import { ListTree } from "lucide-react";
import type { StoryOutlineTreeNode } from "../projection/StoryOutlineTreeProjection.js";
import { EmptyState, LoadingState } from "../../../../shared/primitives/index.js";
import { StoryOutlineTreeLegend } from "./StoryOutlineTreeLegend.js";
import { StoryOutlineTreeRow } from "./StoryOutlineTreeRow.js";
import styles from "./StoryOutlineTree.module.css";

export interface StoryOutlineTreeProps {
  readonly workspaceId: string;
  readonly tree: readonly StoryOutlineTreeNode[];
  readonly phase?: "idle" | "loading" | "ready" | "error";
  readonly expansionState: ReadonlyMap<string, boolean>;
  readonly selectedUnitId?: string;
  readonly onSelectUnit?: (unitId: string) => void;
  readonly onToggleExpand?: (unitId: string) => void;
  /** 底部状态图例（默认开；右栏内容目录关） */
  readonly showLegend?: boolean;
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
  const ready = props.phase === undefined || props.phase === "ready";
  return (
    <div className={styles.tree} data-workspace={props.workspaceId}>
      {props.phase === "loading" ? (
        <LoadingState label="正在加载大纲…" />
      ) : ready && props.tree.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title="大纲还是空的"
          description="在对话中让 Novel Agent 规划故事结构，第一个故事单元会出现在这里。"
        />
      ) : (
        <>
          {props.tree.map((node) => renderNode(node, 0, props))}
          {props.showLegend !== false ? <StoryOutlineTreeLegend /> : null}
        </>
      )}
    </div>
  );
}
