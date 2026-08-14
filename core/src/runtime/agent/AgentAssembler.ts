/**
 * Agent 装配器：把 AgentDefinition 声明解析为 AgentCapability
 * （recipe 按序解析段 → 工具组解析 + allow/deny → nudge 目录过滤）。
 * Agent assembler: resolves an AgentDefinition declaration into an
 * AgentCapability (recipe-ordered sections, tool groups with allow/deny,
 * nudge catalog filtering).
 */
import type { AgentCapability } from "./AgentCapability.js";
import type { AgentDefinition } from "./AgentDefinition.js";
import type { PromptSection } from "../prompt/PromptSection.js";
import type { PromptSectionRegistry } from "../prompt/PromptSectionRegistry.js";
import type {
  PromptPlanItem,
  PromptSectionItem,
  InlinePromptItem,
} from "../prompt/PromptRecipe.js";
import type { ToolDef } from "../tool/ToolDef.js";
import type { ToolGroupManifest } from "../tool/ToolGroupManifest.js";
import type { ContextNudgePolicy } from "../nudge/ContextNudgePolicy.js";
import type { ContextCompactPolicy } from "../compact/ContextCompactPolicy.js";

/** 内联条目包装为静态段时的 id 前缀（id 格式满足段 id 规范） */
const INLINE_SECTION_ID_PREFIX = "inline";

/** Agent 装配器构造选项 */
export interface AgentAssemblerOptions {
  /** Agent 定义（声明式配置） */
  definition: AgentDefinition;
  /** 段注册表（id@version） */
  sectionRegistry: PromptSectionRegistry;
  /** 工具组目录：groupId → manifest（展示层） */
  toolGroupCatalog: ReadonlyMap<string, ToolGroupManifest>;
  /** 工具组解析器：manifest → ToolDef[]（组工厂，缺省抛未知组） */
  resolveToolGroup: (manifest: ToolGroupManifest) => ToolDef[];
  /** nudge 实现目录：nudgeId → policy 工厂（每 agent 实例新建，策略有状态） */
  nudgeCatalog?: ReadonlyMap<string, () => ContextNudgePolicy>;
  /** 压缩策略（agent 定义自带；本期空） */
  compactPolicies?: ContextCompactPolicy[];
}

/**
 * Agent 装配器：声明式定义 → 运行时能力。
 * Agent assembler: declarative definition → runtime capability.
 */
export class AgentAssembler {
  readonly definition: AgentDefinition;
  readonly sectionRegistry: PromptSectionRegistry;
  readonly toolGroupCatalog: ReadonlyMap<string, ToolGroupManifest>;
  readonly resolveToolGroup: (manifest: ToolGroupManifest) => ToolDef[];
  readonly nudgeCatalog: ReadonlyMap<string, () => ContextNudgePolicy>;
  readonly compactPolicies: readonly ContextCompactPolicy[];

  /**
   * 构造装配器
   * @param options 装配选项
   */
  constructor(options: AgentAssemblerOptions) {
    this.definition = options.definition;
    this.sectionRegistry = options.sectionRegistry;
    this.toolGroupCatalog = options.toolGroupCatalog;
    this.resolveToolGroup = options.resolveToolGroup;
    this.nudgeCatalog = options.nudgeCatalog ?? new Map();
    this.compactPolicies = options.compactPolicies ?? [];
  }

  /**
   * 装配 AgentCapability（recipe 段序 + 工具 + nudge + compact）
   * @returns 组装好的能力
   */
  assemble(): AgentCapability {
    return {
      systemSections: this.resolveRecipe(),
      toolDefs: this.resolveTools(),
      compactPolicies: [...this.compactPolicies],
      nudgePolicies: this.resolveNudges(),
    };
  }

  /**
   * 解析 recipe：按 recipe 序解析段（段引用走注册表 / 内联包装为静态段），
   * 校验 static 全在 dynamic 之前（保证 base 缓存 + 动态追加的渲染模型成立）。
   * @returns 有序段列表
   */
  resolveRecipe(): PromptSection[] {
    const sections: PromptSection[] = [];
    let dynamicSeen = false;
    this.definition.promptRecipe.items.forEach((item, index) => {
      const section = this.resolveRecipeItem(item, index);
      if (section.kind === "dynamic") {
        dynamicSeen = true;
      } else if (dynamicSeen) {
        throw new TypeError(
          `Prompt Recipe invalid: static section "${section.id}" after dynamic section`,
        );
      }
      sections.push(section);
    });
    return sections;
  }

  /**
   * 解析工具：按 groupIds 序展开组工具 + allow/deny 过滤。
   * @returns 工具定义列表
   */
  resolveTools(): ToolDef[] {
    const toolPolicy = this.definition.tools;
    const defs: ToolDef[] = [];
    for (const groupId of toolPolicy.groupIds) {
      const manifest = this.toolGroupCatalog.get(groupId);
      if (manifest === undefined) {
        throw new TypeError(`Agent Tool group is unknown: ${groupId}`);
      }
      defs.push(...this.resolveToolGroup(manifest));
    }
    const allow = toolPolicy.allow === undefined ? undefined : new Set(toolPolicy.allow);
    const deny = toolPolicy.deny === undefined ? undefined : new Set(toolPolicy.deny);
    return defs.filter(
      (tool) =>
        (allow === undefined || allow.has(tool.name)) &&
        (deny === undefined || !deny.has(tool.name)),
    );
  }

  /**
   * 解析 nudge：definition.nudgeEnablement.enabled ∩ nudge 实现目录，
   * 按 enabled 声明序实例化（策略有状态，每 agent 实例新建）。
   * 注：legacy 语义为 ∩ 工具组守卫，新架构简化为 ∩ 实现目录。
   * @returns nudge 策略列表
   */
  resolveNudges(): ContextNudgePolicy[] {
    const policies: ContextNudgePolicy[] = [];
    for (const nudgeId of this.definition.nudgeEnablement.enabled) {
      const factory = this.nudgeCatalog.get(nudgeId);
      if (factory !== undefined) policies.push(factory());
    }
    return policies;
  }

  /**
   * 解析单个 recipe 条目（段引用走注册表 / 内联包装为静态段）
   * @param item 条目
   * @param index 条目序号（内联包装 id 用，保证唯一）
   */
  private resolveRecipeItem(item: PromptPlanItem, index: number): PromptSection {
    if (isSectionItem(item)) {
      return this.sectionRegistry.resolve(item.sectionId, item.requestedVersion);
    }
    // PromptPlanItemKind 仅 section/inline 两分支，guard 已排除 section
    return wrapInlineItem(item as InlinePromptItem, index);
  }
}

function isSectionItem(item: PromptPlanItem): item is PromptSectionItem {
  return item.kind === "section";
}

/** 内联条目包装为静态段（id 按 recipe 序号分配，渲染恒定文本） */
function wrapInlineItem(item: InlinePromptItem, index: number): PromptSection {
  return {
    kind: "static",
    id: `${INLINE_SECTION_ID_PREFIX}.${index}`,
    version: "1.0.0",
    label: `Inline Prompt ${index}`,
    render: () => item.content,
  };
}
