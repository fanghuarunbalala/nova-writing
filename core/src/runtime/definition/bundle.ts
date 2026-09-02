/**
 * 定义包（Definition Bundle）——Agent 完整策略面的可序列化载体。
 *
 * 设计（docs/PRD/定义包-agent策略统一.md v0.2）：
 * - 纯数据全量进包：static 段文案、工具组清单/allow-deny、nudge 文案常量与频控、compact 全部参数；
 * - 代码引用只留 id：dynamic 段 rendererId、nudge triggerId、compact policyId、工具 schemaVersion；
 * - 不可变：definitionVersion (semver) 为主键，server 全量保留，老端按能力协商取能跑的最新版。
 *
 * 本模块提供：Bundle 类型 + 从现有编译期 AgentDefinition 导出的导出器。
 * golden 包（definition-novel-1.5.0.json）由 bundle.test.ts 以 WRITE_FIXTURE=1 生成，
 * 既是导出器的回归基线，也是 Kotlin 端（android :core:runtime）的对拍夹具。
 */
import type { AgentDefinition } from "../agent/AgentDefinition.js";
import type { PromptSectionRegistry } from "../prompt/PromptSectionRegistry.js";
import type { PromptRecipeSnapshot } from "../prompt/PromptRecipe.js";

export const BUNDLE_SCHEMA_VERSION = 1 as const;

// ---------- Bundle 类型 ----------

export interface StaticRecipeItem {
  readonly kind: "static";
  readonly sectionId: string;
  readonly version: string;
  /** 段全文（所有 static 段实现都忽略 ctx，可机械提取）。 */
  readonly content: string;
}

export interface DynamicRecipeItem {
  readonly kind: "dynamic";
  readonly sectionId: string;
  readonly version: string;
  /** 端上的渲染器 id（= sectionId），端能力声明必须覆盖。 */
  readonly rendererId: string;
  /** 渲染器参数（M2 导出器不产出，渲染逻辑留端）。 */
  readonly params?: Readonly<Record<string, unknown>>;
}

export type RecipeItem = StaticRecipeItem | DynamicRecipeItem;

export interface ToolGroupRef {
  readonly groupId: string;
  readonly version: string;
  readonly label: string;
  readonly tools: readonly string[];
}

export interface ToolsSpec {
  readonly groups: readonly ToolGroupRef[];
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  /** 工具策略覆盖：requireApproval / promptDetail（schema 本体不进包，与 handler 同版本演进）。 */
  readonly overrides?: Readonly<Record<string, { requireApproval?: boolean; policy?: string; guidance?: string }>>;
}

export interface NudgeRef {
  readonly nudgeId: string;
  /** 触发钩子：persistent（落 journal）/ transient（原地改 ProviderCall）。 */
  readonly trigger: "persistent" | "transient" | "both";
  /** 频控参数（端上的频控实现读取）。 */
  readonly rateLimit?: Readonly<Record<string, unknown>>;
}

export interface CompactPolicySpec {
  readonly policyId: "t1-skeletonize" | "t2-summarize" | "t3-drop-oldest";
  readonly params: Readonly<Record<string, unknown>>;
}

export interface CompactSpec {
  readonly chain: readonly CompactPolicySpec[];
  readonly fuse: { readonly retryOnce: true };
}

export interface DefinitionBundle {
  readonly bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  readonly definitionVersion: string;
  readonly agentType: string;
  readonly label: string;
  readonly prompt: { readonly recipe: readonly RecipeItem[] };
  readonly tools: ToolsSpec;
  readonly nudges: readonly NudgeRef[];
  readonly compact: CompactSpec;
  readonly delegation: { readonly mode: string; readonly allowedAgentTypes: readonly string[] };
  readonly communication: { readonly role: string };
  readonly runtimePolicyId: string;
}

/** 从包内容推导的需求清单——能力协商的依据（resolve 端点按它选版）。 */
export interface BundleRequirements {
  readonly renderers: readonly string[];
  readonly policies: readonly string[];
  readonly triggers: readonly string[];
  readonly toolGroups: readonly string[];
}

export function deriveRequirements(bundle: DefinitionBundle): BundleRequirements {
  return {
    renderers: bundle.prompt.recipe.filter((i) => i.kind === "dynamic").map((i) => i.rendererId),
    policies: bundle.compact.chain.map((p) => p.policyId),
    triggers: bundle.nudges.map((n) => n.nudgeId),
    toolGroups: bundle.tools.groups.map((g) => g.groupId),
  };
}

// ---------- 导出器 ----------

/** nudge 目录触发方式描述（与 NovelAgent.ts nudgeCatalog 对齐）。 */
const NUDGE_TRIGGER: Readonly<Record<string, NudgeRef["trigger"]>> = {
  todo_idle: "persistent",
  max_turn: "persistent",
  project_stage: "persistent",
  external_tools: "persistent",
  compose_mode: "both",
};

/** AutoCompactPolicy 生效缺省值（auto-compact.ts 构造器常量）+ NovelAgentOptions.compact 可覆盖项。 */
export interface CompactExportOverrides {
  t1Ratio?: number;
  t2CapRatio?: number;
  summaryMaxTokens?: number;
}

const COMPACT_DEFAULTS = {
  t1Ratio: 0.7,
  t2MarginTokens: 12000,
  t2CapRatio: 0.92,
  summarySegmentTokens: 40000,
  summaryMaxTokens: 2048,
  keepFirst: 1,
  keepLast: 3,
};

export interface BundleExportOptions {
  /** 工具组目录（NovelToolGroups 的 manifest 快照），默认需调用方传入。 */
  toolGroups: readonly ToolGroupRef[];
  /** compact 覆盖值（NovelAgentOptions.compact 的现值；未传 = 全用缺省）。 */
  compactOverrides?: CompactExportOverrides;
}

export function bundleFromDefinition(
  definition: AgentDefinition,
  registry: PromptSectionRegistry,
  opts: BundleExportOptions,
): DefinitionBundle {
  const snap = definition.toSnapshot();
  const recipe = recipeItems(snap.promptRecipe, registry);
  const groupsById = new Map(opts.toolGroups.map((g) => [g.groupId, g]));
  const groups = snap.tools.groupIds
    .map((id) => groupsById.get(id))
    .filter((g): g is ToolGroupRef => g !== undefined);
  if (groups.length !== snap.tools.groupIds.length) {
    throw new Error("bundle export: 工具组目录缺少 recipe 引用的组");
  }

  const compact = { ...COMPACT_DEFAULTS, ...(opts.compactOverrides ?? {}) };
  return {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    definitionVersion: snap.definitionVersion,
    agentType: snap.agentType,
    label: snap.label,
    prompt: { recipe },
    tools: { groups, allow: snap.tools.allow, deny: snap.tools.deny },
    nudges: snap.nudgeEnablement.enabled.map((nudgeId) => ({
      nudgeId,
      trigger: NUDGE_TRIGGER[nudgeId] ?? "persistent",
    })),
    compact: {
      chain: [
        {
          policyId: "t1-skeletonize",
          params: { t1Ratio: compact.t1Ratio, keepFirst: compact.keepFirst, keepLast: compact.keepLast },
        },
        {
          policyId: "t2-summarize",
          params: {
            t2MarginTokens: compact.t2MarginTokens,
            t2CapRatio: compact.t2CapRatio,
            summarySegmentTokens: compact.summarySegmentTokens,
            summaryMaxTokens: compact.summaryMaxTokens,
          },
        },
        { policyId: "t3-drop-oldest", params: { t3Ratio: compact.t2CapRatio, keepFirst: compact.keepFirst, keepLast: compact.keepLast } },
      ],
      fuse: { retryOnce: true },
    },
    delegation: snap.delegation,
    communication: snap.communication,
    runtimePolicyId: snap.runtimePolicyId,
  };
}

function recipeItems(recipe: PromptRecipeSnapshot, registry: PromptSectionRegistry): RecipeItem[] {
  const items: RecipeItem[] = [];
  for (const item of recipe.items) {
    if (item.kind === "inline") {
      throw new Error("bundle export: inline prompt 项暂不支持（novel 定义未使用）");
    }
    const section = registry.resolve(item.sectionId, item.version);
    if (section.kind === "static") {
      // 所有 static 段实现都忽略 ctx —— 直接提取文案
      items.push({ kind: "static", sectionId: section.id, version: section.version, content: section.render(null as never) });
    } else {
      items.push({ kind: "dynamic", sectionId: section.id, version: section.version, rendererId: section.id });
    }
  }
  return items;
}
