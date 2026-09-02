import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { novelAgentDefinition } from "../agent/definitions/NovelAgentDefinition.js";
import { novelSectionRegistry } from "../agent/definitions/novelSections.js";
import { NOVEL_TOOL_GROUP_CATALOG } from "../tool/groups/NovelToolGroups.js";
import {
  bundleFromDefinition,
  deriveRequirements,
  type DefinitionBundle,
  type ToolGroupRef,
} from "./bundle.js";

/**
 * 定义包导出器测试 + golden 基线：
 * - `WRITE_FIXTURE=1 pnpm -C core vitest run src/runtime/definition/bundle.test.ts` 重新生成 golden 包；
 * - 默认模式逐字节比对——任何策略面变更（段文案/组清单/阈值/nudge）都会使测试变红，
 *   diff 即策略变更的 review 材料（四层对拍门禁的层1 种子）。
 * - golden 包同时是 Kotlin 端（android :core:runtime definition 包）的对拍夹具；
 * - 夹具已迁 `protocol/fixtures/`（双端共享单一来源，Gradle 侧由同步任务复制）。
 */

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "protocol",
  "fixtures",
  "definition-novel-1.5.0.json",
);

function toolGroupsForMain(): ToolGroupRef[] {
  return novelAgentDefinition.tools.toSnapshot().groupIds.map((id) => {
    const manifest = NOVEL_TOOL_GROUP_CATALOG.get(id);
    if (!manifest) throw new Error(`工具组不存在: ${id}`);
    const snap = manifest.toSnapshot();
    return { groupId: snap.id, version: snap.version, label: snap.label, tools: [...snap.tools] };
  });
}

function exportBundle(): DefinitionBundle {
  return bundleFromDefinition(novelAgentDefinition, novelSectionRegistry, { toolGroups: toolGroupsForMain() });
}

describe("定义包导出器", () => {
  it("1.5.0 全策略面导出：结构完整", () => {
    const bundle = exportBundle();
    expect(bundle.bundleSchemaVersion).toBe(1);
    expect(bundle.definitionVersion).toBe("1.5.0");
    expect(bundle.agentType).toBe("novel");
    // 15 段 recipe：6 static + 9 dynamic
    const statics = bundle.prompt.recipe.filter((i) => i.kind === "static");
    const dynamics = bundle.prompt.recipe.filter((i) => i.kind === "dynamic");
    expect(bundle.prompt.recipe).toHaveLength(15);
    expect(statics).toHaveLength(6);
    expect(dynamics).toHaveLength(9);
    // static 文案可提取且非空（core.runtime.protocol 允许空串）
    const identity = statics.find((s) => s.sectionId === "novel.identity");
    expect(identity?.content.length).toBeGreaterThan(0);
    // dynamic 只带 rendererId 引用
    const storyAppeal = dynamics.find((s) => s.sectionId === "novel.story_appeal");
    expect(storyAppeal?.rendererId).toBe("novel.story_appeal");
    expect(storyAppeal?.version).toBe("2.0.0");
  });

  it("工具面：7 组清单 + 无 allow/deny", () => {
    const bundle = exportBundle();
    expect(bundle.tools.groups.map((g) => g.groupId)).toEqual([
      "runtime.todo", "runtime.files", "runtime.ask", "runtime.skills",
      "runtime.external", "novel.compose", "novel.entities",
    ]);
    expect(bundle.tools.groups.find((g) => g.groupId === "novel.entities")?.tools).toContain("NovelWrite");
    expect(bundle.tools.allow).toBeUndefined();
    expect(bundle.tools.deny).toBeUndefined();
  });

  it("compact：生效参数 = 缺省值合并（未传覆盖）", () => {
    const bundle = exportBundle();
    expect(bundle.compact.chain.map((p) => p.policyId)).toEqual(["t1-skeletonize", "t2-summarize", "t3-drop-oldest"]);
    expect(bundle.compact.chain[0]!.params).toMatchObject({ t1Ratio: 0.7, keepFirst: 1, keepLast: 3 });
    expect(bundle.compact.chain[1]!.params).toMatchObject({ t2MarginTokens: 12000, t2CapRatio: 0.92, summaryMaxTokens: 2048 });
    expect(bundle.compact.fuse).toEqual({ retryOnce: true });
  });

  it("nudge：enabled 五项 + 触发方式", () => {
    const bundle = exportBundle();
    expect(bundle.nudges.map((n) => n.nudgeId)).toEqual([
      "compose_mode", "todo_idle", "project_stage", "external_tools", "max_turn",
    ]);
    expect(bundle.nudges.find((n) => n.nudgeId === "compose_mode")?.trigger).toBe("both");
    expect(bundle.nudges.find((n) => n.nudgeId === "todo_idle")?.trigger).toBe("persistent");
  });

  it("需求清单推导（能力协商依据）", () => {
    const req = deriveRequirements(exportBundle());
    expect(req.renderers).toContain("tool.policy");
    expect(req.policies).toEqual(["t1-skeletonize", "t2-summarize", "t3-drop-oldest"]);
    expect(req.triggers).toHaveLength(5);
    expect(req.toolGroups).toHaveLength(7);
  });

  it("golden 基线：与 fixtures/definition-novel-1.5.0.json 逐字节一致", () => {
    const json = JSON.stringify(exportBundle(), null, 2) + "\n";
    if (process.env.WRITE_FIXTURE === "1") {
      mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, json, "utf8");
      return;
    }
    const fixture = readFileSync(FIXTURE_PATH, "utf8");
    expect(json).toBe(fixture);
  });
});
