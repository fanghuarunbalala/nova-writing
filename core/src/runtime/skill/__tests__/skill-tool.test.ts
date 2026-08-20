/**
 * skill 元工具测试：索引注入 promptDetail、按名读取正文、未装配降级、错误归一。
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillTool } from "../../tool/definitions/skill.js";
import { SkillRegistry } from "../SkillRegistry.js";
import { ToolError } from "../../tool/errors.js";
import type { ToolCall } from "../../provider/types.js";

function callOf(name: string, args: unknown): ToolCall {
  return { id: `tc_${Math.random().toString(36).slice(2)}`, name, args: JSON.stringify(args) } as ToolCall;
}

async function makeRegistry(disabled: string[] = []): Promise<SkillRegistry> {
  const root = await mkdtemp(join(tmpdir(), "novel-skill-tool-"));
  const dir = join(root, "suspense");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    "---\nname: suspense\ndescription: 悬疑伏笔写作技法\n---\n# 正文说明\n按此执行。\n",
    "utf8",
  );
  const registry = new SkillRegistry({ dirs: [{ root, source: "project" }], disabled });
  await registry.load();
  return registry;
}

describe("createSkillTool", () => {
  it("promptDetail.guidance 携带生效索引（禁用项不出现）；parameters 只收 name", async () => {
    const registry = await makeRegistry(["suspense"]);
    const tool = createSkillTool(registry);
    expect(tool.name).toBe("skill");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: { name: { type: "string", description: "技能名（见系统提示技能清单）" } },
      required: ["name"],
      additionalProperties: false,
    });
    // 全部禁用 → 索引空串 → tool.guidance 段省略
    expect(tool.promptDetail?.guidance).toBe("");
    await rm(join(registry.get("suspense")!.dir, ".."), { recursive: true, force: true }).catch(() => {});
  });

  it("生效技能：返回剥离 frontmatter 的正文；无 requireApproval", async () => {
    const registry = await makeRegistry();
    const tool = createSkillTool(registry);
    expect(tool.requireApproval).toBeUndefined();
    expect(tool.promptDetail?.guidance).toContain("- suspense — 悬疑伏笔写作技法");
    const result = await tool.handler.execute(callOf("skill", { name: "suspense" }));
    expect(result).toContain("# 正文说明");
    expect(result).not.toContain("name: suspense");
    await rm(join(registry.get("suspense")!.dir, ".."), { recursive: true, force: true }).catch(() => {});
  });

  it("未装配降级：无 promptDetail，调用回不可用文本", async () => {
    const tool = createSkillTool(undefined);
    expect(tool.promptDetail).toBeUndefined();
    const result = await tool.handler.execute(callOf("skill", { name: "x" }));
    expect(result).toContain("技能系统未装配");
  });

  it("不存在 / 已禁用 / 参数非法 → ToolError（中文可自纠消息）", async () => {
    const registry = await makeRegistry(["suspense"]);
    const tool = createSkillTool(registry);
    await expect(tool.handler.execute(callOf("skill", { name: "nope" }))).rejects.toThrowError(
      /技能不存在/,
    );
    const disabledErr = await tool.handler
      .execute(callOf("skill", { name: "suspense" }))
      .catch((err: unknown) => err as ToolError);
    expect(disabledErr).toBeInstanceOf(ToolError);
    expect(disabledErr.message).toContain("已被禁用");
    await expect(tool.handler.execute(callOf("skill", {}))).rejects.toThrowError(/无效的 skill 参数/);
    await expect(tool.handler.execute(callOf("skill", { name: 1 }))).rejects.toThrowError(
      /无效的 skill 参数/,
    );
    await rm(join(registry.get("suspense")!.dir, ".."), { recursive: true, force: true }).catch(() => {});
  });
});
