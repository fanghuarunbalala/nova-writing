import { describe, it, expect } from "vitest";
import { buildNovelAgent } from "../NovelAgent.js";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";

const provider: Provider = {
  call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};
const handle = {
  query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
  mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown;

/** 9 段标记（recipe 序；environment 依赖动态输入） */
const SECTION_MARKERS = [
  "# 身份与创作定位",
  "# 系统与运行规则",
  "# 创作任务",
  "# 谨慎行动",
  "# 交流风格",
  "Operate through the provided Conversation",
  "# 环境信息",
  "# 小说全局约束（NOVEL.md）",
  "Available Tools:",
] as const;

describe("端到端渲染回归（assemble → LoopContext → system prompt）", () => {
  it("9 段按 recipe 序渲染 + 每段恰好一次（锁死 staticSystemCache 短路不回归）", async () => {
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

    // 块序：各标记 indexOf 递增
    const indices = SECTION_MARKERS.map((marker) => {
      const idx = prompt.indexOf(marker);
      expect(idx, `缺段标记: ${marker}`).toBeGreaterThanOrEqual(0);
      return idx;
    });
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
    // 缓存 bug 锁死：static 段内容各出现恰好一次（旧 bug 协议段重复 5 次、novel 4 段为 0）
    expect(prompt.split("Operate through the provided Conversation").length - 1).toBe(1);
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

  it("无 platform/provider：环境块省略 + 约束占位 + 工具清单（23 工具）+ ToolPolicy 追加", async () => {
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
    // 工具清单 23 个 + ToolPolicy（TodoWrite promptDetail）在清单之后
    const toolsIdx = prompt.indexOf("Available Tools:");
    const policyIdx = prompt.indexOf("# ToolPolicy");
    expect(policyIdx).toBeGreaterThan(toolsIdx);
    const toolSection = prompt.slice(toolsIdx, policyIdx);
    for (const name of ["TodoWrite", "Read", "EnterComposeMode", "ExitComposeMode", "CharacterRead", "NovelDelete", "OutlineWrite"]) {
      expect(toolSection).toContain(`- ${name}`);
    }
  });
});
