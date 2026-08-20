/**
 * seedBuiltinSkills 测试：递归拷贝、已存在跳过（用户版本优先）、内置目录缺失回退空。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedBuiltinSkills } from "../seedBuiltinSkills.js";

describe("seedBuiltinSkills", () => {
  let root: string;
  let builtinRoot: string;
  let appRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novel-seed-skills-"));
    builtinRoot = join(root, "builtin-skills");
    appRoot = join(root, "app-skills");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("递归拷贝内置技能（含子目录文件）；非目录条目忽略", async () => {
    await mkdir(join(builtinRoot, "skill-creator", "scripts"), { recursive: true });
    await writeFile(join(builtinRoot, "skill-creator", "SKILL.md"), "---\nname: skill-creator\ndescription: d\n---\nbody\n", "utf8");
    await writeFile(join(builtinRoot, "skill-creator", "scripts", "run.py"), "print('x')\n", "utf8");
    await writeFile(join(builtinRoot, "BUILTIN-SKILLS.md"), "说明文件（应忽略）", "utf8");

    const results = await seedBuiltinSkills(builtinRoot, appRoot);
    expect(results).toEqual([{ name: "skill-creator", seeded: true }]);
    expect(await readFile(join(appRoot, "skill-creator", "SKILL.md"), "utf8")).toContain("skill-creator");
    expect(await readFile(join(appRoot, "skill-creator", "scripts", "run.py"), "utf8")).toContain("print");
  });

  it("目标已存在一律跳过：用户编辑/删除后不覆盖不复活", async () => {
    await mkdir(join(builtinRoot, "skill-creator"), { recursive: true });
    await writeFile(join(builtinRoot, "skill-creator", "SKILL.md"), "---\nname: skill-creator\ndescription: builtin\n---\nbuiltin\n", "utf8");
    await mkdir(join(appRoot, "skill-creator"), { recursive: true });
    await writeFile(join(appRoot, "skill-creator", "SKILL.md"), "---\nname: skill-creator\ndescription: user-edited\n---\nuser\n", "utf8");

    const results = await seedBuiltinSkills(builtinRoot, appRoot);
    expect(results).toEqual([{ name: "skill-creator", seeded: false }]);
    expect(await readFile(join(appRoot, "skill-creator", "SKILL.md"), "utf8")).toContain("user-edited");
  });

  it("内置目录不存在返回空（打包缺失不报错）", async () => {
    const results = await seedBuiltinSkills(join(root, "not-exist"), appRoot);
    expect(results).toEqual([]);
  });
});
