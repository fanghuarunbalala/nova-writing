import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTools } from "../definitions/memory.js";
import { readMemoryTopic } from "../../../memory/MemoryStore.js";
import type { ToolCall } from "../../provider/types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "memory-tools-"));
});

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "tc1", name, args: JSON.stringify(args) };
}

const STATIC_LAYERS = async () => ["# 全局\n- 不要 BE", "# 项目\n- 人称：第一人称"] as const;

function tools(getSource = () => "conv_42#5") {
  return createMemoryTools({ workspace, getSource, staticLayerTexts: STATIC_LAYERS });
}

async function execute(name: string, args: Record<string, unknown>, getSource?: () => string): Promise<string> {
  const def = tools(getSource).find((t) => t.name === name);
  if (def === undefined) throw new Error(`tool not found: ${name}`);
  const result = await def.handler.execute(call(name, args));
  return typeof result === "string" ? result : JSON.stringify(result);
}

describe("runtime.memory 工具集", () => {
  it("MemoryWrite：source 由宿主自动附加（参数无 source 字段，frontmatter 落宿主值）", async () => {
    await execute("MemoryWrite", {
      name: "battle-style",
      type: "feedback",
      description: "打斗场面要短句为主",
      content: "## 规则/事实\n\n打斗短句。\n\n## Why\n\n作者要求。\n\n## How to apply\n\n战斗段落控制句长。",
    });
    const topic = await readMemoryTopic(workspace, "battle-style");
    expect(topic?.source).toBe("conv_42#5");
    // schema 不含 source（模型不可传）
    const def = tools().find((t) => t.name === "MemoryWrite");
    const props = (def?.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).not.toContain("source");
  });

  it("MemoryWrite skip：与静态层逐字重叠被拒并提示去处（作者显式要求保存也适用）", async () => {
    const result = await execute("MemoryWrite", {
      name: "be-taboo",
      type: "feedback",
      description: "不要 BE",
      content: "## 规则/事实\n\n结局不要 BE。",
    });
    expect(result).toContain("已拒绝写入");
    expect(result).toContain("NOVEL.md");
    expect(await readMemoryTopic(workspace, "be-taboo")).toBeUndefined();
  });

  it("MemoryWrite 同义拒绝：与既有条目描述互相包含 → 引导 update/supersede 而非新建", async () => {
    await execute("MemoryWrite", {
      name: "pov-preference",
      type: "feedback",
      description: "作者偏好第一人称叙事视角",
      content: "## 规则/事实\n\n用第一人称。",
    });
    const dup = await execute("MemoryWrite", {
      name: "pov-pref-2",
      type: "feedback",
      description: "作者偏好第一人称叙事视角的偏好",
      content: "## 规则/事实\n\n还是第一人称。",
    });
    expect(dup).toContain("已拒绝新建");
    expect(dup).toContain("pov-preference");
  });

  it("MemoryWrite supersedes：旧条目 superseded、新条目 active、回执含 outcome", async () => {
    await execute("MemoryWrite", {
      name: "old-rule",
      type: "project",
      description: "旧的项目决策条目",
      content: "## 规则/事实\n\n旧决策。",
    });
    const result = await execute("MemoryWrite", {
      name: "new-rule",
      type: "project",
      description: "新的项目决策取代旧决策",
      content: "## 规则/事实\n\n新决策。",
      supersedes: "old-rule",
    });
    expect(result).toContain("已新建记忆 new-rule 并取代旧条目 old-rule");
    expect((await readMemoryTopic(workspace, "old-rule"))?.status).toBe("superseded");
    expect((await readMemoryTopic(workspace, "new-rule"))?.status).toBe("active");
  });

  it("MemoryWrite 参数校验：非法 name/type 抛 TOOL_ARGUMENTS_INVALID", async () => {
    const def = tools().find((t) => t.name === "MemoryWrite");
    await expect(
      def!.handler.execute(call("MemoryWrite", { name: "Bad_Name", type: "feedback", description: "x".repeat(10), content: "y" })),
    ).rejects.toThrow("kebab-case");
    await expect(
      def!.handler.execute(call("MemoryWrite", { name: "ok-name", type: "diary", description: "x".repeat(10), content: "y" })),
    ).rejects.toThrow("type");
  });

  it("MemorySearch：词法命中返回条目；无匹配提示", async () => {
    await execute("MemoryWrite", {
      name: "pov-preference",
      type: "feedback",
      description: "作者偏好第一人称叙事视角",
      content: "## 规则/事实\n\n用第一人称。",
    });
    const hit = await execute("MemorySearch", { query: "pov" });
    expect(hit).toContain("pov-preference");
    const miss = await execute("MemorySearch", { query: "量子物理" });
    expect(miss).toContain("无匹配");
  });

  it("MemoryForget：requireApproval=true；物理删除", async () => {
    await execute("MemoryWrite", {
      name: "temp-note",
      type: "project",
      description: "临时条目待删除",
      content: "## 规则/事实\n\nx。",
    });
    const forgetDef = tools().find((t) => t.name === "MemoryForget");
    expect(forgetDef?.requireApproval).toBe(true);
    const result = await execute("MemoryForget", { name: "temp-note", reason: "过时" });
    expect(result).toContain("已删除");
    expect(await readMemoryTopic(workspace, "temp-note")).toBeUndefined();
  });
});
