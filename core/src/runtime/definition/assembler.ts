/**
 * TS 端包驱动装配器（定义包-端侧迁移 PRD FR2）：
 * 消费 DefinitionBundle 渲染 system prompt——static 段用包内容、dynamic 段按 sectionId 查注册表，
 * 拼接规则与 legacy（LoopContext.renderSystem）逐字节一致：
 *   - static 各段按 recipe 序 join("\n")（空 static 段不过滤——现状行为，core.runtime.protocol 为空串时会产生连续 \n）
 *   - static base 非空才参与；dynamic 段渲染非空才参与；全部用单 "\n" 连接
 * 另提供 compact 包参数 → AutoCompactOptions、工具审批覆盖。
 */
import type { DefinitionBundle } from "./bundle.js";
import type { PromptSectionRegistry } from "../prompt/PromptSectionRegistry.js";
import type { DynamicPromptSectionInput, DynamicPromptSection } from "../prompt/PromptSection.js";
import type { ToolDef } from "../tool/ToolDef.js";
import type { AutoCompactOptions } from "../compact/definitions/auto-compact.js";

/** tool.policy / tool.guidance 消费的最小工具视图。 */
export interface BundleRenderContext {
  readonly toolSchemes: readonly ToolDef[];
}

/** 能力校验：包引用的 dynamic 段必须在注册表中存在且版本可解析。 */
export function validateBundleAgainstRegistry(
  bundle: DefinitionBundle,
  registry: PromptSectionRegistry,
): string[] {
  const missing: string[] = [];
  for (const item of bundle.prompt.recipe) {
    try {
      const section = registry.resolve(item.sectionId, item.version);
      if (section.kind !== item.kind) {
        missing.push(`sectionKindMismatch:${item.sectionId}(bundle=${item.kind},registry=${section.kind})`);
      }
    } catch {
      missing.push(`section:${item.sectionId}@${item.version}`);
    }
  }
  return missing;
}

/** 包驱动渲染 system prompt（与 LoopContext.renderSystem 同一拼接规则）。 */
export function renderSystemFromBundle(
  bundle: DefinitionBundle,
  registry: PromptSectionRegistry,
  input: DynamicPromptSectionInput,
  ctx: BundleRenderContext,
): string {
  // static base：包内容按 recipe 序（空段不过滤，对齐 legacy renderStaticBase）
  const staticParts: string[] = [];
  const dynamicSections: DynamicPromptSection[] = [];
  for (const item of bundle.prompt.recipe) {
    if (item.kind === "static") {
      staticParts.push(item.content);
    } else {
      const section = registry.resolve(item.sectionId, item.version);
      if (section.kind !== "dynamic") {
        throw new Error(`bundle 渲染：段 ${item.sectionId} 应为 dynamic`);
      }
      dynamicSections.push(section);
    }
  }
  const staticBase = staticParts.join("\n");

  const parts: string[] = [];
  if (staticBase.length > 0) parts.push(staticBase);
  for (const section of dynamicSections) {
    const rendered = section.renderDynamic(input, ctx as never);
    if (rendered.length > 0) parts.push(rendered);
  }
  return parts.join("\n");
}

/** 包 compact 参数 → AutoCompactOptions（改包即变阈值，不触动编排结构）。 */
export function autoCompactOptionsFromBundle(bundle: DefinitionBundle): AutoCompactOptions {
  const byId = new Map(bundle.compact.chain.map((p) => [p.policyId, p.params] as const));
  const num = (params: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined => {
    const v = params?.[key];
    return typeof v === "number" ? v : undefined;
  };
  const t1 = byId.get("t1-skeletonize");
  const t2 = byId.get("t2-summarize");
  const t3 = byId.get("t3-drop-oldest");
  return {
    t1Ratio: num(t1, "t1Ratio"),
    t2MarginTokens: num(t2, "t2MarginTokens"),
    t2CapRatio: num(t2, "t2CapRatio"),
    summarySegmentTokens: num(t2, "summarySegmentTokens"),
    summaryMaxTokens: num(t2, "summaryMaxTokens"),
    keepFirst: num(t1, "keepFirst") ?? num(t3, "keepFirst"),
    keepLast: num(t1, "keepLast") ?? num(t3, "keepLast"),
  };
}

/** 工具审批覆盖：bundle.tools.overrides 应用到 ToolDef（策略面数据化的落点）。 */
export function applyToolOverrides(
  toolDefs: readonly ToolDef[],
  bundle: DefinitionBundle,
): ToolDef[] {
  return toolDefs.map((def) => {
    const override = bundle.tools.overrides?.[def.name];
    if (override?.requireApproval === undefined || override.requireApproval === def.requireApproval) {
      return def;
    }
    return { ...def, requireApproval: override.requireApproval };
  });
}
