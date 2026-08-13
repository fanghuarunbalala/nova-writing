/**
 * OutlineUnitInspectorPanel
 *
 * 大纲单元详情（inspector 用）：在大纲树中定位节点并展示状态 + 写路径
 * （编辑 / 新建子单元 / 删除，乐观锁 baseRevision = core StoryUnit.entityVersion）。
 *
 * 复用 StoryOutlineTreeStatus 与 OutlineBlockNote，结构与原型 detail-card 对齐：
 * head（title + scope + status）+ dMeta（progress）+ note（block/abandoned）。
 */
import { useState } from "react";
import { OutlineBlockNote } from "../../../domains/novel/outline/components/OutlineBlockNote.js";
import { StoryOutlineTreeStatus } from "../../../domains/novel/outline/components/StoryOutlineTreeStatus.js";
import { StoryUnitEditDialog } from "../../../domains/novel/outline/components/StoryUnitEditDialog.js";
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
  const coreUnit = outlineTree.getUnit(unitId);
  const [editOpen, setEditOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);

  if (unit === undefined) {
    return <div className={styles.panel}>未找到大纲单元</div>;
  }
  return (
    <div className={styles.panel} data-workspace={workspaceId}>
      <div className={styles.head}>
        <h3 className={styles.title}>{unit.label}</h3>
        <span className={styles.scope}>{unit.scope}</span>
        <StoryOutlineTreeStatus planM={unit.planM} realNode={unit.realNode} />
      </div>
      <div className={styles.dMeta}>{unit.unitId}</div>
      {unit.progress !== undefined ? (
        <div className={styles.dMeta}>
          已完成 {unit.progress.completed}/{unit.progress.total}
        </div>
      ) : null}
      {unit.blockedReason !== undefined ? (
        <OutlineBlockNote kind="blocked" reason={unit.blockedReason} />
      ) : null}
      {unit.abandonedReason !== undefined ? (
        <OutlineBlockNote kind="abandoned" reason={unit.abandonedReason} />
      ) : null}
      <div className={styles.dFoot}>
        <button type="button" className={styles.action} onClick={() => setEditOpen(true)}>
          编辑
        </button>
        <button type="button" className={styles.action} onClick={() => setChildOpen(true)}>
          新建子单元
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            if (coreUnit === undefined) return;
            // eslint-disable-next-line no-alert
            if (!window.confirm(`确定删除大纲单元「${unit.label}」？其子单元将一并删除。`)) return;
            void outlineTree.deleteStoryUnit(unitId, coreUnit.entityVersion);
          }}
        >
          删除
        </button>
      </div>
      <StoryUnitEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="编辑大纲单元"
        error={snapshot.error?.message}
        initial={
          coreUnit !== undefined
            ? {
                title: coreUnit.title,
                intent: coreUnit.intent ?? "",
                synopsis: coreUnit.synopsis ?? "",
                scope: coreUnit.scope,
              }
            : undefined
        }
        onSubmit={(input) =>
          outlineTree.updateStoryUnit(
            unitId,
            { title: input.title, intent: input.intent, synopsis: input.synopsis, scope: input.scope },
            coreUnit!.entityVersion,
          )
        }
      />
      <StoryUnitEditDialog
        open={childOpen}
        onOpenChange={setChildOpen}
        title="新建子单元"
        error={snapshot.error?.message}
        onSubmit={(input) =>
          outlineTree.createStoryUnit({ parentId: unitId as never, ...input })
        }
      />
    </div>
  );
}
