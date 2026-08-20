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
  /**
   * 对外序号（全书 / 一、 / 1.1 / 1.1.1）：saga 根为「全书」；
   * 顶层幕用中文序数，其下用点分数字（序号段数即层级，动态计算）。
   */
  readonly ordinal: string;
  /** 层级超深（序号段数 > 3，即全书之下超过 3 层）——存量脏数据警示 */
  readonly overDepth: boolean;
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

/** 中文序数（顶层幕编号：一、二、…；≥100 回退阿拉伯数字——实际不可达） */
function chineseNumeral(n: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n < 0 || n >= 100 || !Number.isInteger(n)) return String(n);
  if (n < 10) return digits[n]!;
  if (n < 20) return n === 10 ? "十" : `十${digits[n % 10]!}`;
  const ones = n % 10;
  return `${digits[Math.floor(n / 10)]!}十${ones === 0 ? "" : digits[ones]!}`;
}

/** 序号 → 树行前缀（一 → 「一、」；1.1 → 「1.1 」；全书 → 空串） */
export function ordinalLabel(ordinal: string): string {
  if (ordinal === "全书" || ordinal === "") return "";
  return ordinal.includes(".") ? `${ordinal} ` : `${ordinal}、`;
}

/** 数字路径 → 序号（段数 1 → 中文序数；≥2 → 点分；>3 段 = 超深） */
export function ordinalOfPath(path: readonly number[]): { ordinal: string; overDepth: boolean } {
  if (path.length === 0) return { ordinal: "", overDepth: false };
  if (path.length === 1) return { ordinal: chineseNumeral(path[0]!), overDepth: false };
  return { ordinal: path.join("."), overDepth: path.length > 3 };
}

export const StoryOutlineTreeProjection = {
  build(units: readonly StoryUnit[]): readonly StoryOutlineTreeNode[] {
    interface MutableNode extends Omit<StoryOutlineTreeNode, "children" | "depth" | "parentTitle" | "ordinal" | "overDepth"> {
      children: MutableNode[];
      depth: number;
      parentTitle: string | undefined;
      ordinal: string;
      overDepth: boolean;
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
        ordinal: "",
        overDepth: false,
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
    // 序号与书序都按 orderKey 升序（store 列表无 ORDER BY，不能依赖插入顺序）
    const sortSiblings = (siblings: MutableNode[]): void => {
      siblings.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
      for (const child of siblings) sortSiblings(child.children);
    };
    for (const root of roots) sortSiblings(root.children);
    roots.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    /**
     * 序号标注：saga 根为空路径（「全书」）；游离顶层根直接取 [i]（序数兜底，
     * 其子层为 1.1 形态，避免与父层序号重复）；其余节点 = 父路径 + 兄弟序。
     * 段数 1 → 中文序数，≥2 → 点分，>3 段 = 超深（全书之下最多 3 层）。
     */
    const annotate = (
      node: MutableNode,
      depth: number,
      parentTitle: string | undefined,
      path: readonly number[],
    ): void => {
      node.depth = depth;
      node.parentTitle = parentTitle;
      if (path.length === 0) {
        node.ordinal = "全书";
        node.overDepth = false;
      } else {
        const { ordinal, overDepth } = ordinalOfPath(path);
        node.ordinal = ordinal;
        node.overDepth = overDepth;
      }
      node.children.forEach((child, index) => {
        annotate(child, depth + 1, node.title, [...path, index + 1]);
      });
    };
    roots.forEach((root, index) => {
      annotate(root, 0, undefined, root.scope === "saga" ? [] : [index + 1]);
    });
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
