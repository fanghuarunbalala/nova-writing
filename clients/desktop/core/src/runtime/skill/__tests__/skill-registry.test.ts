/**
 * SkillRegistry + skillsEnv 测试：扫描/解析/校验/生效过滤/正文读取/env 往返。
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillRegistry,
  parseSkillMarkdown,
  renderSkillIndex,
} from "../SkillRegistry.js";
import {
  parseSkillsEnv,
  serializeSkillsEnv,
  resolveSkillDirs,
} from "../skillsEnv.js";

/** 造一个临时技能根目录 */
async function makeSkillsRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "novel-skills-"));
}

/** 写一个标准技能包 */
async function writeSkill(
  root: string,
  dirName: string,
  name: string,
  description: string,
  body = "技能正文",
): Promise<void> {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
    "utf8",
  );
}

describe("parseSkillMarkdown", () => {
  it("解析合法 frontmatter（LF）", () => {
    const parsed = parseSkillMarkdown("---\nname: a\ndescription: b\n---\n正文\n");
    expect(parsed).toBeDefined();
    expect(parsed?.frontmatter).toContain("name: a");
    expect(parsed?.body).toBe("正文\n");
  });

  it("兼容 CRLF", () => {
    const parsed = parseSkillMarkdown("---\r\nname: a\r\ndescription: b\r\n---\r\n正文\r\n");
    expect(parsed).toBeDefined();
    expect(parsed?.body).toContain("正文");
  });

  it("无 frontmatter / 缺闭合围栏返回 undefined", () => {
    expect(parseSkillMarkdown("正文")).toBeUndefined();
    expect(parseSkillMarkdown("---\nname: a")).toBeUndefined();
  });
});

describe("SkillRegistry", () => {
  it("扫描两级目录：项目级同名覆盖应用级，按名排序", async () => {
    const app = await makeSkillsRoot();
    const project = await makeSkillsRoot();
    await writeSkill(app, "alpha", "alpha", "应用级技能");
    await writeSkill(app, "shared", "shared", "应用级同名");
    await writeSkill(project, "beta", "beta", "项目级技能");
    await writeSkill(project, "shared-2", "shared", "项目级同名覆盖");
    const registry = new SkillRegistry({
      dirs: [
        { root: app, source: "app" },
        { root: project, source: "project" },
      ],
    });
    await registry.load();
    expect(registry.list().map((s) => s.name)).toEqual(["alpha", "beta", "shared"]);
    expect(registry.get("shared")?.source).toBe("project");
    expect(registry.get("alpha")?.source).toBe("app");
    await rm(app, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it("目录不存在视为空集；非法技能记录错误并跳过", async () => {
    const root = await makeSkillsRoot();
    // 合法 + 缺 SKILL.md + 非法 name + 缺 description
    await writeSkill(root, "good", "good", "好技能");
    await mkdir(join(root, "no-file"));
    await mkdir(join(root, "bad-name"));
    await writeFile(join(root, "bad-name", "SKILL.md"), "---\nname: Bad_Name\ndescription: x\n---\nb\n", "utf8");
    await mkdir(join(root, "no-desc"));
    await writeFile(join(root, "no-desc", "SKILL.md"), "---\nname: nodesc\n---\nb\n", "utf8");
    const registry = new SkillRegistry({ dirs: [{ root, source: "project" }] });
    await registry.load();
    expect(registry.list().map((s) => s.name)).toEqual(["good"]);
    expect(registry.scanErrors().map((e) => e.dir)).toHaveLength(3);
    await rm(root, { recursive: true, force: true });
  });

  it("生效 = 发现且未禁用；readBody 剥离 frontmatter", async () => {
    const root = await makeSkillsRoot();
    await writeSkill(root, "one", "one", "技能一", "# 方法论\n步骤…");
    await writeSkill(root, "two", "two", "技能二");
    const registry = new SkillRegistry({
      dirs: [{ root, source: "project" }],
      disabled: ["two"],
    });
    await registry.load();
    expect(registry.effective().map((s) => s.name)).toEqual(["one"]);
    expect(registry.isEffective("one")).toBe(true);
    expect(registry.isDisabled("two")).toBe(true);
    expect(registry.isEffective("two")).toBe(false);
    const body = await registry.readBody("one");
    expect(body).toBe("# 方法论\n步骤…\n");
    await rm(root, { recursive: true, force: true });
  });

  it("readBundledFile：技能内相对路径可读；逃逸/绝对路径抛错；缺文件 undefined；超限截断附尾注", async () => {
    const root = await makeSkillsRoot();
    await writeSkill(root, "one", "one", "技能一");
    await mkdir(join(root, "one", "references"), { recursive: true });
    await writeFile(join(root, "one", "references", "schemas.md"), "# schema\n字段…\n", "utf8");
    const registry = new SkillRegistry({ dirs: [{ root, source: "project" }] });
    await registry.load();
    const record = registry.get("one")!;
    expect(await registry.readBundledFile(record, "references/schemas.md")).toContain("# schema");
    expect(await registry.readBundledFile(record, "references/nope.md")).toBeUndefined();
    await expect(registry.readBundledFile(record, "../other/SKILL.md")).rejects.toThrowError(/逃逸/);
    await expect(registry.readBundledFile(record, "C:/x")).rejects.toThrowError(/逃逸/);
    // POSIX 绝对路径（Linux 前置拒绝 / Windows 经 resolve 到其他根后被逃逸检查拒绝）
    await expect(registry.readBundledFile(record, "/etc/passwd")).rejects.toThrowError(/逃逸/);
    await expect(registry.readBundledFile(record, "")).rejects.toThrowError(/非法/);

    // 超限截断：>512 KiB 附尾注
    await writeFile(join(root, "one", "big.txt"), "x".repeat(512 * 1024 + 100), "utf8");
    const truncated = await registry.readBundledFile(record, "big.txt");
    expect(truncated!.length).toBeLessThan(512 * 1024 + 200);
    expect(truncated).toContain("[已截断，原文件");
    await rm(root, { recursive: true, force: true });
  });
});

describe("renderSkillIndex", () => {
  it("空清单返回空串（提示段省略）", () => {
    expect(renderSkillIndex([])).toBe("");
  });

  it("仅含 name + description 单行清单与使用指引", () => {
    const index = renderSkillIndex([
      {
        name: "suspense",
        description: "悬疑伏笔写作技法",
        source: "project",
        dir: "/d",
        file: "/d/SKILL.md",
      },
    ]);
    expect(index).toContain("# 技能（Skills）");
    expect(index).toContain("- suspense — 悬疑伏笔写作技法");
    expect(index).toContain("skill 工具");
    expect(index).not.toContain("技能正文");
  });
});

describe("skillsEnv", () => {
  it("serialize → parse 往返", () => {
    const raw = serializeSkillsEnv({ appSkillsRoot: "/app/skills", disabled: ["a", "b"] });
    const parsed = parseSkillsEnv(raw);
    expect(parsed).toEqual({ appSkillsRoot: "/app/skills", disabled: ["a", "b"] });
  });

  it("缺失/非法 JSON/非法结构返回 undefined；名单内非字符串项过滤", () => {
    expect(parseSkillsEnv(undefined)).toBeUndefined();
    expect(parseSkillsEnv("")).toBeUndefined();
    expect(parseSkillsEnv("not-json")).toBeUndefined();
    expect(parseSkillsEnv("42")).toBeUndefined();
    expect(parseSkillsEnv('{"disabled":["a",1,true]}')).toEqual({ disabled: ["a"] });
    expect(parseSkillsEnv("{}")).toEqual({ disabled: [] });
  });

  it("resolveSkillDirs：app + project（workspace/skills）", () => {
    const dirs = resolveSkillDirs({ appSkillsRoot: "/app/skills", disabled: [] }, "/ws");
    expect(dirs).toEqual([
      { root: "/app/skills", source: "app" },
      { root: join("/ws", "skills"), source: "project" },
    ]);
    expect(resolveSkillDirs({ disabled: [] }, "/ws")).toEqual([
      { root: join("/ws", "skills"), source: "project" },
    ]);
  });
});
