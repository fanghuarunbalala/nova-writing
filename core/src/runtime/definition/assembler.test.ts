import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { novelAgentDefinition } from "../agent/definitions/NovelAgentDefinition.js";
import { novelSectionRegistry } from "../agent/definitions/novelSections.js";
import { NOVEL_TOOL_GROUP_CATALOG } from "../tool/groups/NovelToolGroups.js";
import { toolPolicySection, toolGuidanceSection, coreEnvironmentSection } from "../prompt/sections/agent.js";
import { bundleFromDefinition, type DefinitionBundle, type ToolGroupRef } from "./bundle.js";
import {
  applyToolOverrides,
  autoCompactOptionsFromBundle,
  renderSystemFromBundle,
  validateBundleAgainstRegistry,
} from "./assembler.js";
import type { ToolDef } from "../tool/ToolDef.js";

/**
 * 零漂移基线（定义包-端侧迁移 PRD FR3）：
 * - golden 包 static 内容 == 注册表现场渲染（代码与包的漂移探测器）；
 * - 包驱动 renderSystemFromBundle == legacy 规则参考实现（拼接规则一致性）；
 * - parity-sections.json：三个 dynamic 段的 TS 渲染输出，Kotlin 端逐字节复刻对拍（层1/2 种子）。
 *   `WRITE_PARITY=1` 重新生成。
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));

function golden(): DefinitionBundle {
  const toolGroups: ToolGroupRef[] = novelAgentDefinition.tools.toSnapshot().groupIds.map((id) => {
    const snap = NOVEL_TOOL_GROUP_CATALOG.get(id)!.toSnapshot();
    return { groupId: snap.id, version: snap.version, label: snap.label, tools: [...snap.tools] };
  });
  return bundleFromDefinition(novelAgentDefinition, novelSectionRegistry, { toolGroups });
}

describe("包驱动装配：零漂移", () => {
  it("golden static 内容与注册表现场渲染逐字节一致（代码↔包漂移探测）", () => {
    const bundle = golden();
    for (const item of bundle.prompt.recipe) {
      if (item.kind !== "static") continue;
      const section = novelSectionRegistry.resolve(item.sectionId, item.version);
      expect(section.kind).toBe("static");
      if (section.kind === "static") {
        expect(item.content).toBe(section.render(null as never));
      }
    }
  });

  it("包内 dynamic 版本与注册表解析版本一致；能力校验通过", () => {
    const bundle = golden();
    expect(validateBundleAgainstRegistry(bundle, novelSectionRegistry)).toEqual([]);
    const dynamic = bundle.prompt.recipe.filter((i) => i.kind === "dynamic");
    for (const item of dynamic) {
      expect(novelSectionRegistry.resolve(item.sectionId, item.version).version).toBe(item.version);
    }
  });

  it("renderSystemFromBundle == legacy 拼接规则参考实现", () => {
    const bundle = golden();
    const fixtureTools = fixtureToolDefs();
    const input = { environment: { workdir: "/workspace/nova", platform: "darwin", modelId: "deepseek-chat" } };
    const ctx = { toolSchemes: fixtureTools };

    // legacy 参考实现：LoopContext.renderSystem 的规则（static base 一次 join，dynamic 非空追加，全部 "\n"）
    const sections = bundle.prompt.recipe.map((item) =>
      novelSectionRegistry.resolve(item.sectionId, item.version),
    );
    const staticBase = sections
      .filter((s) => s.kind === "static")
      .map((s) => (s.kind === "static" ? s.render(null as never) : ""))
      .join("\n");
    const parts: string[] = [];
    if (staticBase.length > 0) parts.push(staticBase);
    for (const s of sections) {
      if (s.kind === "dynamic") {
        const rendered = s.renderDynamic(input, ctx as never);
        if (rendered.length > 0) parts.push(rendered);
      }
    }
    const legacyRender = parts.join("\n");

    expect(renderSystemFromBundle(bundle, novelSectionRegistry, input, ctx)).toBe(legacyRender);
    // 空工具时 tool.policy 输出占位单行（现状语义）
    const noTools = renderSystemFromBundle(
      bundle, novelSectionRegistry,
      { environment: undefined },
      { toolSchemes: [] },
    );
    expect(noTools).toContain("No Tools are available in this Agent Manifest.");
  });

  it("compact 包参数 → AutoCompactOptions（golden = 缺省值）", () => {
    expect(autoCompactOptionsFromBundle(golden())).toEqual({
      t1Ratio: 0.7, t2MarginTokens: 12_000, t2CapRatio: 0.92,
      summarySegmentTokens: 40_000, summaryMaxTokens: 2_048, keepFirst: 1, keepLast: 3,
    });
    // 改包即变阈值：t1Ratio 0.5
    const tuned = golden();
    tuned.compact.chain[0]!.params = { ...tuned.compact.chain[0]!.params, t1Ratio: 0.5 };
    expect(autoCompactOptionsFromBundle(tuned).t1Ratio).toBe(0.5);
  });

  it("工具审批覆盖：改包即变审批面", () => {
    const tools = fixtureToolDefs();
    const overridden = golden();
    overridden.tools = {
      ...overridden.tools,
      overrides: { NovelWrite: { requireApproval: false } },
    };
    const effective = applyToolOverrides(tools, overridden);
    expect(effective.find((t) => t.name === "NovelWrite")!.requireApproval).toBe(false);
    expect(effective.find((t) => t.name === "NovelRead")!.requireApproval).toBe(true);
  });

  it("parity 夹具：三个 dynamic 段渲染输出（Kotlin 逐字节复刻对拍）", () => {
    const tools = fixtureToolDefs();
    const ctx = { toolSchemes: tools };
    const parity = {
      fixtureTools: tools.map((t) => ({ name: t.name, policy: t.promptDetail?.policy ?? "", guidance: t.promptDetail?.guidance ?? "" })),
      toolPolicy: toolPolicySection.kind === "dynamic" ? toolPolicySection.renderDynamic({}, ctx as never) : "",
      toolGuidance: toolGuidanceSection.kind === "dynamic" ? toolGuidanceSection.renderDynamic({}, ctx as never) : "",
      environment: coreEnvironmentSection.kind === "dynamic"
        ? coreEnvironmentSection.renderDynamic(
            { environment: { workdir: "/workspace/nova", platform: "darwin", modelId: "deepseek-chat" } },
            ctx as never,
          )
        : "",
    };
    const file = path.join(DIR, "fixtures", "parity-sections.json");
    if (process.env.WRITE_PARITY === "1") {
      writeFileSync(file, JSON.stringify(parity, null, 2) + "\n", "utf8");
      return;
    }
    const fixture = JSON.parse(readFileSync(file, "utf8")) as typeof parity;
    // 断言格式锚点（完整对拍在 Kotlin 侧做，这里锚定关键字节）
    expect(fixture.toolPolicy.split("\n")[0]).toBe("# Using Tools");
    expect(fixture.toolPolicy.split("\n")[1]).toMatch(/^- available tools: .+;$/);
    expect(fixture.environment.split("\n")[0]).toBe("# 环境信息");
    expect(fixture.environment).toMatch(/^- 平台：darwin$/m);
    expect(fixture.environment).toMatch(/^- 工作目录：\/workspace\/nova$/m);
    expect(fixture.environment).toMatch(/^- 模型：deepseek-chat$/m);
  });
});

/** 对拍夹具工具面（双端共享的输入数据）。 */
function fixtureToolDefs(): ToolDef[] {
  const base = (name: string, extra: Partial<ToolDef> = {}): ToolDef => ({
    name,
    description: `${name} 描述`,
    parameters: { type: "object" },
    version: "1.0.0",
    handler: async () => "ok",
    ...extra,
  });
  return [
    base("TodoWrite", { promptDetail: { policy: "", guidance: "" } }),
    base("NovelRead", {
      requireApproval: true,
      promptDetail: { policy: "读取实体前先确认 id 存在", guidance: "" },
    }),
    base("NovelWrite", {
      requireApproval: true,
      promptDetail: {
        policy: "写入前必须带 baseRevision（乐观锁）",
        guidance: "段落写入指导：\n1. 先读后写\n2. 失败读版本号自纠",
      },
    }),
    base("Read", { promptDetail: { policy: "", guidance: "  " } }),
  ];
}
