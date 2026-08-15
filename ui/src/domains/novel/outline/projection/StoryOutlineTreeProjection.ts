/**
 * StoryOutlineTreeProjection
 *
 * 把 core 的 StoryUnit 列表投影为带层级的大纲树（纯函数）。
 * 字段对齐 core 契约：scope 五档原样保留（缺省 custom）；
 * blocked 为派生态（realizationStatus=pending 且有 blockState）；
 * progress 取 includePlans 读路径附带的叶完成度 rollup。
 */
import type {
  StoryUnit,
  StoryUnitAbandonment,
  StoryUnitBlockState,
  StoryUnitPlanningStatus,
  StoryUnitScope,
} from "@novel/core";
import { realizationView, type RealizationView } from "../outlineStatus.js";

export interface StoryOutlineTreeNode {
  readonly unitId: string;
  readonly title: string;
  readonly scope: StoryUnitScope;
  readonly planningStatus: StoryUnitPlanningStatus;
  readonly realization: RealizationView;
  readonly orderKey: string;
  readonly entityVersion: number;
  readonly depth: number;
  readonly parentTitle: string | undefined;
  readonly blockState: StoryUnitBlockState | undefined;
  readonly abandonment: StoryUnitAbandonment | undefined;
  readonly blockedReason: string | undefined;
  readonly abandonedReason: string | undefined;
  readonly progress: { readonly completed: number; readonly total: number } | undefined;
  readonly children: readonly StoryOutlineTreeNode[];
}

/** includePlans 读路径的单元可能附带 rollup（StoryUnitWithLeaf.progress） */
type UnitWithPlans = StoryUnit & {
  readonly progress?: {
    readonly completedLeafCount: number;
    readonly totalLeafCount: number;
  };
};

export const StoryOutlineTreeProjection = {
  build(units: readonly StoryUnit[]): readonly StoryOutlineTreeNode[] {
    interface MutableNode extends Omit<StoryOutlineTreeNode, "children" | "depth" | "parentTitle"> {
      children: MutableNode[];
      depth: number;
      parentTitle: string | undefined;
    }
    const nodes = new Map<string, MutableNode>();
    for (const unit of units) {
      const withPlans = unit as UnitWithPlans;
      nodes.set(unit.id, {
        unitId: unit.id,
        title: unit.title,
        scope: unit.scope ?? "custom",
        planningStatus: unit.planningStatus,
        realization: realizationView(unit),
        orderKey: unit.orderKey,
        entityVersion: unit.entityVersion,
        depth: 0,
        parentTitle: undefined,
        blockState: unit.blockState,
        abandonment: unit.abandonment,
        blockedReason:
          unit.blockState !== undefined
            ? unit.blockState.note ?? unit.blockState.reasonCode
            : undefined,
        abandonedReason:
          unit.abandonment !== undefined
            ? unit.abandonment.note ?? unit.abandonment.reasonCode
            : undefined,
        progress:
          withPlans.progress !== undefined && withPlans.progress.totalLeafCount > 0
            ? {
                completed: withPlans.progress.completedLeafCount,
                total: withPlans.progress.totalLeafCount,
              }
            : undefined,
        children: [],
      });
    }
    const roots: MutableNode[] = [];
    for (const unit of units) {
      const node = nodes.get(unit.id)!;
      const parent = unit.parentId === undefined ? undefined : nodes.get(unit.parentId);
      if (parent === undefined) {
        roots.push(node);
      } else {
        parent.children.push(node);
      }
    }
    const annotate = (node: MutableNode, depth: number, parentTitle: string | undefined): void => {
      node.depth = depth;
      node.parentTitle = parentTitle;
      for (const child of node.children) {
        annotate(child, depth + 1, node.title);
      }
    };
    for (const root of roots) {
      annotate(root, 0, undefined);
    }
    const freeze = (node: MutableNode): StoryOutlineTreeNode =>
      Object.freeze({
        ...node,
        children: Object.freeze(node.children.map(freeze)),
      });
    return Object.freeze(roots.map(freeze));
  },

  findPath(
    tree: readonly StoryOutlineTreeNode[],
    unitId: string,
  ): readonly string[] | undefined {
    for (const node of tree) {
      if (node.unitId === unitId) return [node.unitId];
      const childPath = StoryOutlineTreeProjection.findPath(node.children, unitId);
      if (childPath !== undefined) return [node.unitId, ...childPath];
    }
    return undefined;
  },

  /** 全部单元数（dirHead 计数；含各级子单元） */
  countAll(tree: readonly StoryOutlineTreeNode[]): number {
    let count = 0;
    const walk = (nodes: readonly StoryOutlineTreeNode[]): void => {
      for (const node of nodes) {
        count += 1;
        walk(node.children);
      }
    };
    walk(tree);
    return count;
  },
};
