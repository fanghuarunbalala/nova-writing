/**
 * skill 元工具测试：正文读取、捆绑文件 path 读取（技能内沙盒）、未装配降级、错误归一。
 * 索引渲染已迁 skill.index 动态段（见 skill-registry.test.ts / skill-index 段用例）。
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

/** 造含捆绑文件的技能注册表（suspense：SKILL.md + references/schemas.md） */
async function makeRegistry(disabled: string[] = []): Promise<SkillRegistry> {
  const root = await mkdtemp(join(tmpdir(), "novel-skill-tool-"));
  const dir = join(root, "suspense");
  await mkdir(join(dir, "references"), { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    "---\nname: suspense\ndescription: 悬疑伏笔写作技法\n---\n# 正文说明\n按此执行。\n",
    "utf8",
  );
  await writeFile(join(dir, "references", "schemas.md"), "# evals.json schema\n字段说明…\n", "utf8");
  const registry = new SkillRegistry({ dirs: [{ root, source: "project" }], disabled });
  await registry.load();
  return registry;
}

function rootOf(registry: SkillRegistry): string {
  const record = registry.get("suspense")!;
  return join(record.dir, "..");
}

describe("createSkillTool", () => {
  it("parameters 收 name + 可选 path；无 promptDetail（索引已迁 skill.index 段）", async () => {
    const registry = await makeRegistry(["suspense"]);
    const tool = createSkillTool(registry);
    expect(tool.name).toBe("skill");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "技能名（见系统提示技能清单）" },
        path: {
          type: "string",
          description:
            "技能内相对路径（可选；缺省读 SKILL.md 正文，如 references/schemas.md 读捆绑参考文件）",
        },
      },
      required: ["name"],
      additionalProperties: false,
    });
    expect(tool.promptDetail).toBeUndefined();
    expect(tool.requireApproval).toBeUndefined();
    await rm(rootOf(registry), { recursive: true, force: true }).catch(() => {});
  });

  it("生效技能：返回剥离 frontmatter 的正文（path 缺省，行为不变）", async () => {
    const registry = await makeRegistry();
    const tool = createSkillTool(registry);
    const result = await tool.handler.execute(callOf("skill", { name: "suspense" }));
    expect(result).toContain("# 正文说明");
    expect(result).not.toContain("name: suspense");
    await rm(rootOf(registry), { recursive: true, force: true }).catch(() => {});
  });

  it("path 读取捆绑资源文件（技能内相对路径）", async () => {
    const registry = await makeRegistry();
    const tool = createSkillTool(registry);
    const result = await tool.handler.execute(
      callOf("skill", { name: "suspense", path: "references/schemas.md" }),
    );
    expect(result).toContain("# evals.json schema");
    await rm(rootOf(registry), { recursive: true, force: true }).catch(() => {});
  });

  it("path 逃逸（.. / 绝对路径）→ ToolError 拒绝；缺文件 → 明确错误", async () => {
    const registry = await makeRegistry();
    const tool = createSkillTool(registry);
    const escape = await tool.handler
      .execute(callOf("skill", { name: "suspense", path: "../other/SKILL.md" }))
      .catch((e: unknown) => e as ToolError);
    expect(escape).toBeInstanceOf(ToolError);
    expect(escape.message).toContain("逃逸");

    const absolute = await tool.handler
      .execute(callOf("skill", { name: "suspense", path: "C:/Windows/win.ini" }))
      .catch((e: unknown) => e as ToolError);
    expect(absolute).toBeInstanceOf(ToolError);
    expect(absolute.message).toContain("逃逸");

    await expect(
      tool.handler.execute(callOf("skill", { name: "suspense", path: "references/nope.md" })),
    ).rejects.toThrowError(/技能内文件不存在/);
    await rm(rootOf(registry), { recursive: true, force: true }).catch(() => {});
  });

  it("未装配降级：调用回不可用文本", async () => {
    const tool = createSkillTool(undefined);
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
    await expect(
      tool.handler.execute(callOf("skill", { name: "x", path: 1 })),
    ).rejects.toThrowError(/无效的 skill 参数/);
    await rm(rootOf(registry), { recursive: true, force: true }).catch(() => {});
  });
});

describe("skillIndexSection（skill.index 动态段）", () => {
  it("有快照渲染索引清单（仅 name + description）；无快照/空清单返回空串省略", async () => {
    const { skillIndexSection } = await import("../skillIndexSection.js");
    const render = (input: Parameters<typeof skillIndexSection.renderDynamic>[0]) =>
      skillIndexSection.renderDynamic(input, {} as never);

    const withSkills = render({
      skills: { entries: [{ name: "suspense", description: "悬疑伏笔写作技法" }] },
    });
    expect(withSkills).toContain("# 技能（Skills）");
    expect(withSkills).toContain("- suspense — 悬疑伏笔写作技法");
    expect(withSkills).not.toContain("技能正文");

    expect(render({})).toBe("");
    expect(render({ skills: { entries: [] } })).toBe("");
  });
});
