/**
 * StoryOutlineTreeProjection
 *
 * 把 core 的 StoryUnit 列表投影为带层级的大纲树（纯函数）。
 * 映射说明：scope 仅保留 ARC/SCENE（saga/sequence/custom 归入 SCENE）；
 * pending + blockState -> blocked；blockedReason/abandonedReason 取 note 优先。
 */
import type {
  StoryUnit,
  StoryUnitProgressProjection,
} from "@novel/core";

export interface StoryOutlineTreeNode {
  readonly unitId: string;
  readonly label: string;
  readonly scope: "ARC" | "SCENE";
  readonly planM: 1 | 2 | 3; // idea / outlined / ready
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
  readonly blockedReason?: string;
  readonly abandonedReason?: string;
  readonly progress?: { readonly completed: number; readonly total: number };
  readonly children: readonly StoryOutlineTreeNode[];
}

function mapPlanM(status: StoryUnit["planningStatus"]): 1 | 2 | 3 {
  switch (status) {
    case "idea":
      return 1;
    case "outlined":
      return 2;
    case "ready":
      return 3;
  }
}

function mapRealNode(unit: StoryUnit): StoryOutlineTreeNode["realNode"] {
  if (unit.realizationStatus === "pending" && unit.blockState !== undefined) {
    return "blocked";
  }
  switch (unit.realizationStatus) {
    case "in-progress":
      return "in-progress";
    case "completed":
      return "completed";
    case "abandoned":
      return "abandoned";
    default:
      return "pending";
  }
}

export const StoryOutlineTreeProjection = {
  build(
    units: readonly StoryUnit[],
    progress: readonly StoryUnitProgressProjection[] = [],
  ): readonly StoryOutlineTreeNode[] {
    const progressByUnitId = new Map(progress.map((item) => [item.storyUnitId, item]));
    interface MutableNode extends Omit<StoryOutlineTreeNode, "children"> {
      children: MutableNode[];
    }
    const nodes = new Map<string, MutableNode>();
    for (const unit of units) {
      const unitProgress = progressByUnitId.get(unit.id);
      nodes.set(unit.id, {
        unitId: unit.id,
        label: unit.title,
        scope: unit.scope === "arc" ? "ARC" : "SCENE",
        planM: mapPlanM(unit.planningStatus),
        realNode: mapRealNode(unit),
        ...(unit.blockState !== undefined
          ? { blockedReason: unit.blockState.note ?? unit.blockState.reasonCode }
          : {}),
        ...(unit.abandonment !== undefined
          ? { abandonedReason: unit.abandonment.note ?? unit.abandonment.reasonCode }
          : {}),
        ...(unitProgress !== undefined && unitProgress.totalLeafCount > 0
          ? { progress: { completed: unitProgress.completedLeafCount, total: unitProgress.totalLeafCount } }
          : {}),
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
};
