import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAgentCaseFrontMatter,
  scanAgentCases,
  seedAgentCasesIfNeeded,
  readAgentCaseContent,
  renderAgentCasesIndex,
  clearAgentCasesScanCache,
  AGENT_CASE_MAX_BYTES,
} from "../workspace/agentCases.js";

describe("parseAgentCaseFrontMatter（纯函数）", () => {
  it("规范 front-matter → 全字段条目（含 order）", () => {
    const entry = parseAgentCaseFrontMatter(
      "outline-refine.md",
      "---\ntask_type: outline-refine\ncharacter_type: -\nsituation: -\nsummary: 大纲细化：拆到不可再分\norder: 10\n---\n\n正文",
    );
    expect(entry).toMatchObject({
      file: "outline-refine.md",
      path: ".novel/cases/outline-refine.md",
      taskType: "outline-refine",
      summary: "大纲细化：拆到不可再分",
      order: 10,
    });
    expect(entry?.characterType).toBeUndefined();
    expect(entry?.situation).toBeUndefined();
  });

  it("可选字段有值 → 保留；引号包裹值剥引号", () => {
    const entry = parseAgentCaseFrontMatter(
      "a.md",
      '---\ntask_type: prose-draft\ncharacter_type: 群像\nsituation: "高潮"\n---\n正文',
    );
    expect(entry).toMatchObject({ taskType: "prose-draft", characterType: "群像", situation: "高潮" });
  });

  it("无围栏 / 围栏未闭合 / 缺 task_type → undefined（整份跳过）", () => {
    expect(parseAgentCaseFrontMatter("a.md", "没有围栏的普通文档")).toBeUndefined();
    expect(parseAgentCaseFrontMatter("a.md", "---\ntask_type: prose-draft\n正文（未闭合）")).toBeUndefined();
    expect(parseAgentCaseFrontMatter("a.md", "---\nsummary: 缺任务类型\n---\n正文")).toBeUndefined();
    expect(parseAgentCaseFrontMatter("a.md", "---\ntask_type: -\n---\n正文")).toBeUndefined();
  });

  it("坏行（无冒号/空行）跳过，不阻断其余字段解析；order 非数字视为缺省", () => {
    const entry = parseAgentCaseFrontMatter(
      "a.md",
      "---\n这是坏行\ntask_type: outline-refine\norder: abc\n---\n正文",
    );
    expect(entry).toMatchObject({ taskType: "outline-refine" });
    expect(entry?.order).toBeUndefined();
  });
});

describe("seedAgentCasesIfNeeded（node 层，env 指定母版）", () => {
  let masterRoot: string;
  let master: string;

  beforeEach(async () => {
    masterRoot = await mkdtemp(join(tmpdir(), "agent-cases-master-"));
    master = join(masterRoot, "agent-cases");
    await mkdir(master, { recursive: true });
    await writeFile(
      join(master, "a.md"),
      "---\ntask_type: outline-refine\nsummary: 大纲细化\n---\n正文A",
      "utf8",
    );
    process.env.NOVEL_AGENT_CASES_DIR = master;
  });

  afterEach(async () => {
    delete process.env.NOVEL_AGENT_CASES_DIR;
    clearAgentCasesScanCache();
    await rm(masterRoot, { recursive: true, force: true });
  });

  it("目录缺失 → 从母版拷贝并返回 true", async () => {
    const ws = await mkdtemp(join(tmpdir(), "agent-cases-ws-"));
    expect(await seedAgentCasesIfNeeded(ws)).toBe(true);
    const entries = await scanAgentCases(ws);
    expect(entries?.map((e) => e.file)).toEqual(["a.md"]);
    await rm(ws, { recursive: true, force: true });
  });

  it("目录已存在 → 跳过且永不覆盖用户改动", async () => {
    const ws = await mkdtemp(join(tmpdir(), "agent-cases-ws-"));
    await mkdir(join(ws, ".novel", "cases"), { recursive: true });
    await writeFile(
      join(ws, ".novel", "cases", "user.md"),
      "---\ntask_type: user-custom\n---\n用户自己维护",
      "utf8",
    );
    expect(await seedAgentCasesIfNeeded(ws)).toBe(false);
    const entries = await scanAgentCases(ws);
    expect(entries?.map((e) => e.file)).toEqual(["user.md"]); // 母版 a.md 未被拷入
    await rm(ws, { recursive: true, force: true });
  });

  it("母版不可用（env 指向不存在目录）→ false（降级不抛）", async () => {
    process.env.NOVEL_AGENT_CASES_DIR = join(masterRoot, "no-such-master");
    const ws = await mkdtemp(join(tmpdir(), "agent-cases-ws-"));
    expect(await seedAgentCasesIfNeeded(ws)).toBe(false);
    await rm(ws, { recursive: true, force: true });
  });
});

describe("scanAgentCases / readAgentCaseContent / renderAgentCasesIndex", () => {
  let ws: string;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), "agent-cases-scan-"));
    clearAgentCasesScanCache();
  });

  afterEach(async () => {
    clearAgentCasesScanCache();
    await rm(ws, { recursive: true, force: true });
  });

  async function writeCase(file: string, frontMatter: string): Promise<void> {
    await mkdir(join(ws, ".novel", "cases"), { recursive: true });
    await writeFile(join(ws, ".novel", "cases", file), `${frontMatter}\n---\n正文`, "utf8");
  }

  it("目录缺失 → undefined；有效案例按 order 缺省文件名序，无效文件跳过", async () => {
    expect(await scanAgentCases(ws)).toBeUndefined();
    await writeCase("b.md", "---\ntask_type: prose-draft\norder: 20");
    await writeCase("a.md", "---\ntask_type: outline-refine\norder: 10");
    await writeCase("d.md", "---\ntask_type: prose-draft");
    await writeCase("c-bad.md", "无围栏坏文件");
    await writeCase("notes.txt", "---\ntask_type: outline-refine\n---"); // 非 md 不参与
    const entries = await scanAgentCases(ws);
    expect(entries?.map((e) => e.file)).toEqual(["a.md", "b.md", "d.md"]); // order 序，无 order 殿后按文件名
  });

  it("mtime 缓存：目录变更（新增文件）触发重扫", async () => {
    await writeCase("a.md", "---\ntask_type: outline-refine");
    expect((await scanAgentCases(ws))?.length).toBe(1);
    await writeCase("b.md", "---\ntask_type: prose-draft");
    expect((await scanAgentCases(ws))?.length).toBe(2);
  });

  it("readAgentCaseContent：正常读取 / 缺失 undefined / 超限 undefined", async () => {
    await writeCase("a.md", "---\ntask_type: outline-refine");
    expect(await readAgentCaseContent(ws, "a.md")).toContain("正文");
    expect(await readAgentCaseContent(ws, "nope.md")).toBeUndefined();
    await writeFile(
      join(ws, ".novel", "cases", "big.md"),
      "x".repeat(AGENT_CASE_MAX_BYTES + 1),
      "utf8",
    );
    expect(await readAgentCaseContent(ws, "big.md")).toBeUndefined();
  });

  it("renderAgentCasesIndex：每案一行，含路径与标签、可选维度按需输出", () => {
    const text = renderAgentCasesIndex([
      {
        file: "a.md",
        path: ".novel/cases/a.md",
        taskType: "outline-refine",
        summary: "大纲细化",
        order: 10,
      },
      {
        file: "b.md",
        path: ".novel/cases/b.md",
        taskType: "opening-design",
        characterType: "群像",
        situation: "opening",
        summary: "",
        order: 20,
      },
    ]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("- .novel/cases/a.md ｜ task=outline-refine ｜ 大纲细化");
    expect(lines[1]).toBe("- .novel/cases/b.md ｜ task=opening-design character=群像 situation=opening");
  });
});
