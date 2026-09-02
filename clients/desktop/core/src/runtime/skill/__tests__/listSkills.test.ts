/**
 * listSkills 服务测试：两级目录扫描 + 禁用标记 + 空目录回退。
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills } from "../listSkills.js";

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "novel-list-skills-"));
}

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n正文\n`, "utf8");
}

describe("listSkills", () => {
  it("扫描两级目录并标记禁用；未开工作区时 projectRoot 缺省", async () => {
    const app = await makeRoot();
    const project = await makeRoot();
    await writeSkill(app, "alpha", "应用级");
    await writeSkill(project, "beta", "项目级");
    const result = await listSkills({
      appRoot: app,
      projectRoot: project,
      disabled: ["beta"],
    });
    expect(result.appRoot).toBe(app);
    expect(result.projectRoot).toBe(project);
    expect(result.skills.map((s) => [s.name, s.disabled])).toEqual([
      ["alpha", false],
      ["beta", true],
    ]);
    await rm(app, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it("目录不存在返回空清单（含根路径，供空态提示）", async () => {
    const result = await listSkills({
      appRoot: join(tmpdir(), "novel-not-exist-app"),
      disabled: [],
    });
    expect(result.projectRoot).toBeUndefined();
    expect(result.skills).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
