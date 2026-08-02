/** Separate StoryUnit scope, planning, realization, block, and progress tokens. */
import type { StoryUnitTreeNodeView } from "./StoryOutlineTreeView.js";

const PLANNING_LABELS = Object.freeze({
  idea: "构想",
  outlined: "已大纲",
  ready: "可写",
});

const REALIZATION_LABELS = Object.freeze({
  pending: "未开始",
  "in-progress": "进行中",
  completed: "已完成",
  abandoned: "已放弃",
});

export function StoryOutlineTreeStatus({ node }: { readonly node: StoryUnitTreeNodeView }) {
  return (
    <span className="novel-outline-statuses">
      {node.scope !== undefined ? (
        <span className="novel-outline-badge" data-badge-kind="scope">
          {node.scope.label}
        </span>
      ) : null}
      <span className="novel-outline-badge" data-badge-kind="planning">
        {PLANNING_LABELS[node.planningStatus]}
      </span>
      <span className="novel-outline-badge" data-badge-kind="realization">
        {REALIZATION_LABELS[node.realizationStatus]}
      </span>
      {node.blockState !== undefined ? (
        <span
          className="novel-outline-badge"
          data-badge-kind="blocked"
          title={node.blockState.label}
        >
          阻塞
        </span>
      ) : null}
      {node.progress.totalLeafCount > 1 || node.childIds.length > 0 ? (
        <span className="novel-outline-progress" aria-label="已完成叶节点进度">
          {node.progress.completedLeafCount}/{node.progress.totalLeafCount}
        </span>
      ) : null}
    </span>
  );
}
