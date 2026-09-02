import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNovelAgent } from "../NovelAgent.js";
import { SkillRegistry } from "../../skill/SkillRegistry.js";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";

const provider: Provider = {
  call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};
const handle = {
  query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
  mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown;

/** 8 个段标记（recipe 序；environment 依赖动态输入；清空段与空 guidance 不产出标记） */
const SECTION_MARKERS = [
  "# 身份与创作定位",
  "# 系统与运行规则",
  "# 创作任务",
  "# 谨慎行动",
  "# 交流风格",
  "# Using Tools",
  "# 环境信息",
  "# 小说全局约束（NOVEL.md）",
] as const;

describe("端到端渲染回归（assemble → LoopContext → system prompt）", () => {
  it("段按 recipe 序渲染 + 每段恰好一次（锁死 staticSystemCache 短路不回归）", async () => {
    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      conversationId: "conv-1",
      platform: "Windows",
      novelConstraintsProvider: async () => ({
        fileName: "NOVEL.md",
        content: "# 世界观\n- 基调热血",
      }),
    });
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    // 经 AgentLoop 内部 LoopContext 拿最近一次渲染的 system prompt
    const prompt = (loop as unknown as { context: { systemPrompt: string } }).context.systemPrompt;

    // 块序：各标记 indexOf 递增（tool.policy 在 env 前、guidance 全空省略）
    const indices = SECTION_MARKERS.map((marker) => {
      const idx = prompt.indexOf(marker);
      expect(idx, `缺段标记: ${marker}`).toBeGreaterThanOrEqual(0);
      return idx;
    });
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
    // 缓存 bug 锁死：static 段内容各出现恰好一次（旧 bug 协议段重复 5 次、novel 4 段为 0）
    expect(prompt.split("# 身份与创作定位").length - 1).toBe(1);
    expect(prompt.split("# 创作任务").length - 1).toBe(1);
    expect(prompt.split("# 谨慎行动").length - 1).toBe(1);
  });

  it("dynamic 段注入：环境块（workdir/platform/model 补齐）+ 约束标签包裹", async () => {
    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      conversationId: "conv-1",
      platform: "Windows",
      novelConstraintsProvider: async () => ({
        fileName: "NOVEL.md",
        content: "# 世界观\n- 基调热血",
      }),
    });
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    const prompt = (loop as unknown as { context: { systemPrompt: string } }).context.systemPrompt;
    expect(prompt).toContain("- 平台：Windows");
    expect(prompt).toContain("- 工作目录：/ws");
    expect(prompt).toContain("- 模型：gpt-5"); // run.sampling.model 补齐
    const wrapStart = prompt.indexOf("<Novel-Constraints-Content>");
    const wrapEnd = prompt.indexOf("</Novel-Constraints-Content>");
    expect(wrapStart).toBeGreaterThanOrEqual(0);
    expect(wrapEnd).toBeGreaterThan(wrapStart);
    expect(prompt.slice(wrapStart, wrapEnd)).toContain("# 世界观");
    expect(prompt.slice(wrapStart, wrapEnd)).toContain("基调热血");
  });

  it("无 platform/provider：环境块省略 + 约束占位 + 工具名单（27 工具）+ 无 ToolPolicy 块", async () => {
    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      conversationId: "conv-1",
    });
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    const prompt = (loop as unknown as { context: { systemPrompt: string } }).context.systemPrompt;
    expect(prompt).not.toContain("# 环境信息");
    expect(prompt).toContain("（当前无可用内容");
    // promptDetail policy/guidance 已全量清空 → 名单行后无 policy 行、guidance 段省略；
    // 旧 renderSystem 的 # ToolPolicy 块路径已删除
    const toolsIdx = prompt.indexOf("# Using Tools");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(prompt).not.toContain("# ToolPolicy");
    const toolSection = prompt.slice(toolsIdx);
    for (const name of ["TodoWrite", "Read", "AskUserQuestion", "EnterComposeMode", "ExitComposeMode", "NovelRead", "NovelDelete", "NovelWrite"]) {
      expect(toolSection).toContain(name);
    }
    // 名单行格式：单行逗号分隔
    expect(toolSection).toContain("- available tools: TodoWrite");
    // Write 的 policy 优先级行（名单行后原样一行）
    expect(toolSection).toContain("改已有文件用 Edit，禁止 Write 覆盖做小改动");
  });

  it("skill.index 全链路：skills 注册表 → system prompt 含技能索引（tool.guidance 后、正文不进）；无 skills 时整段省略", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-render-skills-"));
    const skillDir = join(root, "suspense");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: suspense\ndescription: 悬疑伏笔写作技法\n---\n# 正文说明（不得进入索引）\n",
      "utf8",
    );
    const registry = new SkillRegistry({
      dirs: [{ root, source: "project" }],
      disabled: ["banned"],
    });
    await registry.load();

    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      conversationId: "conv-1",
      skills: { registry },
    });
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    const prompt = (loop as unknown as { context: { systemPrompt: string } }).context.systemPrompt;
    // 索引块渲染：清单 + 使用指引；正文与 frontmatter 不进
    expect(prompt).toContain("# 技能（Skills）");
    expect(prompt).toContain("- suspense — 悬疑伏笔写作技法");
    expect(prompt).not.toContain("# 正文说明");
    // 段序：skill.index 在 tool.policy（# Using Tools）之后
    expect(prompt.indexOf("# 技能（Skills）")).toBeGreaterThan(prompt.indexOf("# Using Tools"));
    await rm(root, { recursive: true, force: true });

    // 无 skills：整段省略
    const bare = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    await bare.run("hi", { sampling: { model: "gpt-5" } });
    const barePrompt = (bare as unknown as { context: { systemPrompt: string } }).context.systemPrompt;
    expect(barePrompt).not.toContain("# 技能（Skills）");
    // 工具名单仍含 skill 元工具（装配期降级存在）
    expect(barePrompt).toContain("skill");
  });
});
