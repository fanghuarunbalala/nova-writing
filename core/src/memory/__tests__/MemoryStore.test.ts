import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forgetMemoryTopic,
  overlapsStaticLayer,
  parseIndex,
  parseTopic,
  readMemoryIndexForInjection,
  readMemoryTopic,
  rebuildMemoryIndex,
  renderIndexLine,
  searchMemoryTopics,
  syncMemoryIndex,
  writeMemoryTopic,
} from "../MemoryStore.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "memory-store-"));
});

async function writeTopic(name: string, description: string, type: string, extra = ""): Promise<void> {
  await mkdir(join(workspace, "memory"), { recursive: true });
  await writeFile(
    join(workspace, "memory", `${name}.md`),
    `---\nname: ${name}\ntype: ${type}\ndescription: ${description}\ncreated: 2026-08-29T10:00:00+08:00\nmodified: 2026-08-29T10:00:00+08:00\nsource: conv_1#2\nstatus: active\n---\n\n## 规则/事实\n\n${description}\n${extra}`,
    "utf8",
  );
}

describe("MemoryStore", () => {
  it("writeMemoryTopic 新建：主题文件 + 索引行（先文件后索引）+ source 落 frontmatter", async () => {
    const receipt = await writeMemoryTopic(
      workspace,
      {
        name: "cliches-taboo",
        type: "feedback",
        description: "作者反感忽然类滥词",
        content: "## 规则/事实\n\n避免使用「忽然」。\n\n## Why\n\n作者认为滥。\n\n## How to apply\n\n改用具体动作过渡。",
      },
      "conv_42#5",
    );
    expect(receipt.outcome).toBe("created");
    expect(receipt.indexLines).toBe(1);
    const topic = await readMemoryTopic(workspace, "cliches-taboo");
    expect(topic?.source).toBe("conv_42#5");
    expect(topic?.status).toBe("active");
    expect(topic?.body).toContain("## How to apply");
    const index = await readFile(join(workspace, "memory", "MEMORY.md"), "utf8");
    expect(index).toContain("- cliches-taboo — 作者反感忽然类滥词（feedback）");
  });

  it("同义更新：同名覆盖、created/source 保留、modified 刷新；改口 supersedes 旧条目标 superseded 不进索引", async () => {
    await writeMemoryTopic(
      workspace,
      { name: "pov-preference", type: "feedback", description: "人称偏好第一人称", content: "第一人称。" },
      "conv_1#2",
    );
    const updated = await writeMemoryTopic(
      workspace,
      { name: "pov-preference", type: "feedback", description: "人称偏好第三人称", content: "第三人称。" },
      "conv_9#9",
    );
    expect(updated.outcome).toBe("updated");
    const topic = await readMemoryTopic(workspace, "pov-preference");
    expect(topic?.source).toBe("conv_1#2"); // 保留首见 source
    expect(topic?.modified >= topic!.created).toBe(true); // modified 刷新为本次时间
    expect(topic?.description).toBe("人称偏好第三人称");

    // 改口：新条目 supersedes 旧条目
    const superseded = await writeMemoryTopic(
      workspace,
      {
        name: "pov-third",
        type: "feedback",
        description: "本书人称改用第三人称限知",
        content: "第三人称限知。",
        supersedes: "pov-preference",
      },
      "conv_9#10",
    );
    expect(superseded.outcome).toBe("superseded");
    expect(superseded.superseded).toBe("pov-preference");
    const old = await readMemoryTopic(workspace, "pov-preference");
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe("pov-third");
    // 索引只含 active
    const snapshot = await readMemoryIndexForInjection(workspace);
    expect(snapshot?.entries.map((e) => e.name)).toEqual(["pov-third"]);
    // superseded 检索可查
    const hits = await searchMemoryTopics(workspace, "pov");
    expect(hits.some((h) => h.name === "pov-preference" && h.status === "superseded")).toBe(true);
  });

  it("索引确定序：type 分组（author→feedback→project→reference）+ 组内 name 字典序；重建稳定", async () => {
    await writeTopic("zeta-note", "z", "author");
    await writeTopic("alpha-note", "a", "feedback");
    await writeTopic("mid-note", "m", "author");
    await writeTopic("ref-note", "r", "reference");
    const snapshot = await readMemoryIndexForInjection(workspace);
    expect(snapshot?.entries.map((e) => e.name)).toEqual(["mid-note", "zeta-note", "alpha-note", "ref-note"]);
    // 以主题文件重建后顺序不变
    await rm(join(workspace, "memory", "MEMORY.md"), { force: true });
    await syncMemoryIndex(workspace);
    const rebuilt = await readMemoryIndexForInjection(workspace);
    expect(rebuilt?.entries.map((e) => e.name)).toEqual(["mid-note", "zeta-note", "alpha-note", "ref-note"]);
  });

  it("注入预算：>200 条截断 truncated=true（磁盘文件完整）；types 过滤（Compose author/feedback）", async () => {
    for (let i = 0; i < 205; i++) {
      await writeTopic(`entry-${String(i).padStart(3, "0")}`, `条目${i}`, i % 2 === 0 ? "author" : "project");
    }
    const snapshot = await readMemoryIndexForInjection(workspace);
    expect(snapshot?.entries.length).toBeLessThanOrEqual(200);
    expect(snapshot?.truncated).toBe(true);
    // types 过滤
    const filtered = await readMemoryIndexForInjection(workspace, { types: ["author"] });
    expect(filtered?.entries.every((e) => e.type === "author")).toBe(true);
    expect(filtered?.entries.length).toBe(103); // 0,2,...,204
    // 空过滤结果 → undefined（段省略）
    const none = await readMemoryIndexForInjection(workspace, { types: ["reference"] });
    expect(none).toBeUndefined();
  });

  it("词法检索打分：名称精确 3 > 名称包含 2 > 描述包含 1；同分 name 字典序；maxResults 截断", async () => {
    await writeTopic("pov-preference", "人称偏好相关", "feedback");
    await writeTopic("pov-style", "文风", "feedback");
    await writeTopic("other-note", "人称偏好相关", "project");
    const exact = await searchMemoryTopics(workspace, "pov-preference");
    expect(exact[0]?.name).toBe("pov-preference");
    const contains = await searchMemoryTopics(workspace, "pov 人称");
    // 多词累加：pov-preference(名含2+desc含1=3) > pov-style(名含2) > other-note(desc含1)
    expect(contains.map((h) => h.name)).toEqual(["pov-preference", "pov-style", "other-note"]);
    const limited = await searchMemoryTopics(workspace, "pov 人称", 1);
    expect(limited.map((h) => h.name)).toEqual(["pov-preference"]);
  });

  it("forget：物理删除 + 索引同步；不存在返回 false", async () => {
    await writeTopic("gone-soon", "待删", "project");
    expect(await forgetMemoryTopic(workspace, "gone-soon")).toBe(true);
    expect(await readMemoryTopic(workspace, "gone-soon")).toBeUndefined();
    const snapshot = await readMemoryIndexForInjection(workspace);
    expect(snapshot).toBeUndefined();
    expect(await forgetMemoryTopic(workspace, "gone-soon")).toBe(false);
  });

  it("一致性：写入中断（索引被手删/损坏）以主题文件为准重建；corrupted 文件列出", async () => {
    await writeTopic("good-note", "好条目", "feedback");
    await mkdir(join(workspace, "memory"), { recursive: true });
    await writeFile(join(workspace, "memory", "bad.md"), "不是合法 frontmatter", "utf8");
    const report = await rebuildMemoryIndex(workspace);
    expect(report.active).toBe(1);
    expect(report.corrupted).toEqual(["bad.md"]);
    const indexText = await readFile(join(workspace, "memory", "MEMORY.md"), "utf8");
    expect(indexText).toContain("good-note");
  });

  it("skip 机械校验 overlapsStaticLayer：description/首条规则在静态层逐字出现 → 命中", () => {
    const staticTexts = ["# NOVEL.md\n- 人称：第一人称\n- 禁忌：不要 BE"];
    expect(overlapsStaticLayer("不要 BE", "## 规则/事实\n\n别的", staticTexts)).toBeDefined();
    expect(overlapsStaticLayer("人称：第一人称", "x", staticTexts)).toBeDefined();
    expect(overlapsStaticLayer("作者喜欢短句节奏", "## 规则/事实\n\n战斗场面短句为主", staticTexts)).toBeUndefined();
  });

  it("parseIndex/renderIndexLine/parseTopic 往返", () => {
    const line = renderIndexLine({ name: "a-note", description: "描述", type: "author" });
    expect(line).toBe("- a-note — 描述（author）");
    expect(parseIndex(line)).toEqual([{ name: "a-note", description: "描述", type: "author" }]);
    const topic = parseTopic(
      "---\nname: a-note\ntype: author\ndescription: 描述\ncreated: t1\nmodified: t2\nsource: c#1\nstatus: superseded\nsuperseded-by: b-note\n---\n\n正文",
      "a-note.md",
    );
    expect(topic?.status).toBe("superseded");
    expect(topic?.supersededBy).toBe("b-note");
    expect(topic?.body).toBe("正文");
  });
});
