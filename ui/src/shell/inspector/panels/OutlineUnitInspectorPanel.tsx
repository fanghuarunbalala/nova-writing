/**
 * OutlineUnitInspectorPanel
 *
 * 大纲单元详情：在大纲树中定位节点并展示状态。
 */
import { OutlineBlockNote } from "../../../domains/novel/outline/components/OutlineBlockNote.js";
import { StoryOutlineTreeStatus } from "../../../domains/novel/outline/components/StoryOutlineTreeStatus.js";
import type { StoryOutlineTreeNode } from "../../../domains/novel/outline/projection/StoryOutlineTreeProjection.js";
import type { StoryOutlineTreeStore } from "../../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import styles from "./OutlineUnitInspectorPanel.module.css";

function findNode(
  tree: readonly StoryOutlineTreeNode[],
  unitId: string,
): StoryOutlineTreeNode | undefined {
  for (const node of tree) {
    if (node.unitId === unitId) return node;
    const child = findNode(node.children, unitId);
    if (child !== undefined) return child;
  }
  return undefined;
}

export interface OutlineUnitInspectorPanelProps {
  readonly workspaceId: string | undefined;
  readonly unitId: string;
  readonly outlineTree: StoryOutlineTreeStore;
}

export function OutlineUnitInspectorPanel({
  workspaceId,
  unitId,
  outlineTree,
}: OutlineUnitInspectorPanelProps) {
  const snapshot = useExternalStore(outlineTree);
  const unit = findNode(snapshot.tree, unitId);
  if (unit === undefined) {
    return <div className={styles.panel}>未找到大纲单元</div>;
  }
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <header className={styles.head}>
        <h3 className={styles.title}>{unit.label}</h3>
        <span className={styles.scope}>{unit.scope}</span>
        <StoryOutlineTreeStatus planM={unit.planM} realNode={unit.realNode} />
      </header>
      {unit.progress !== undefined ? (
        <span className={styles.progress}>
          已完成 {unit.progress.completed}/{unit.progress.total}
        </span>
      ) : null}
      {unit.blockedReason !== undefined ? (
        <OutlineBlockNote kind="blocked" reason={unit.blockedReason} />
      ) : null}
      {unit.abandonedReason !== undefined ? (
        <OutlineBlockNote kind="abandoned" reason={unit.abandonedReason} />
      ) : null}
    </div>
  );
}
