/**
 * 注入回归 golden（PRD memory-两层记忆 §6.1 / §7）：
 * 两层 NOVEL.md + MEMORY.md 索引在每次 provider call 注入，且 compact（阈值路径）
 * 之后仍在场；拼接顺序与优先级标注正确；单层缺失只注另一层；空索引段省略；
 * 提取 pass 在压缩判定通过后、压缩执行前调用且每纪元一次。
 */
import { describe, it, expect } from "vitest";
import { LoopContext } from "../LoopContext.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import { novelGlobalConstraintsSection } from "../../prompt/sections/novel.js";
import { memoryIndexSection } from "../../prompt/sections/memory.js";
import type { RunContext } from "../types.js";

const capability: AgentCapability = {
  systemSections: [novelGlobalConstraintsSection, memoryIndexSection],
  toolDefs: [],
  compactPolicies: [],
  nudgePolicies: [],
};

const RUN_PROGRESS = { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() } as const;

function makeRun(content = "hi"): RunContext {
  const messages: RunContext["messages"] = [{ role: "user", content }];
  return {
    seq: 0,
    messages,
    ts: "t",
    appendRunMessages: (m) => {
      messages.push(...m);
    },
  };
}

describe("两层记忆注入回归（golden）", () => {
  it("两层 NOVEL.md + 索引拼接注入：全局在前项目在后、优先级标注、索引段含使用契约", async () => {
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      novelConstraintsProvider: async () => ({ global: "不要 BE（全局）", project: "人称：第一人称（项目）" }),
      memoryIndexProvider: async () => ({
        entries: [{ name: "battle-style", description: "打斗要短句", type: "feedback" }],
        truncated: false,
      }),
    });
    const call = await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    const system = call.system as string;
    // 两层都在场 + 拼接顺序（全局前、项目后）
    expect(system).toContain("不要 BE（全局）");
    expect(system).toContain("人称：第一人称（项目）");
    expect(system.indexOf("不要 BE（全局）")).toBeLessThan(system.indexOf("人称：第一人称（项目）"));
    // 优先级标注
    expect(system).toContain("项目层优先于全局层");
    // 索引段
    expect(system).toContain("battle-style");
    expect(system).toContain("memory/<name>.md");
    // 信任边界
    expect(system).toContain("信当下");
  });

  it("压缩后（阈值路径）两层与索引仍在场——有损事件不丢静态层与记忆索引", async () => {
    // 压缩策略：清空全部 runs（模拟 T2/T3 销毁原文）
    const compacting: AgentCapability = {
      ...capability,
      compactPolicies: [
        {
          shouldCompact: () => true,
          compact: async (loop) => {
            for (const run of loop.runs) run.messages.length = 0;
            return true;
          },
        },
      ],
    };
    const ctx = new LoopContext({
      agentCapability: compacting,
      workspace: "/ws",
      novelConstraintsProvider: async () => ({ global: "全局约束 G", project: "项目约束 P" }),
      memoryIndexProvider: async () => ({
        entries: [{ name: "note", description: "条目", type: "project" }],
        truncated: false,
      }),
    });
    ctx.appendRun(makeRun("长对话"));
    const call = await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(ctx.compactionGeneration).toBe(1);
    expect(call.system).toContain("全局约束 G");
    expect(call.system).toContain("项目约束 P");
    expect(call.system).toContain("- note — 条目");
  });

  it("单层缺失只注另一层；两层全缺渲染占位；空索引段省略", async () => {
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      novelConstraintsProvider: async () => ({ project: "只有项目层" }),
      memoryIndexProvider: async () => undefined,
    });
    const call = await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(call.system).toContain("只有项目层");
    expect(call.system).not.toContain("Novel-Constraints-Global");
    // 空索引 → memory.index 段整体省略
    expect(call.system).not.toContain("跨会话记忆");

    const empty = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      novelConstraintsProvider: async () => undefined,
    });
    const emptyCall = await empty.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(emptyCall.system).toContain("当前两层均无可用内容");
  });

  it("索引超预算：truncated 标记渲染截断提示（截断本身在生产提供者层完成）", async () => {
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      memoryIndexProvider: async () => ({
        entries: [
          { name: "entry-a", description: "da", type: "project" },
          { name: "entry-b", description: "db", type: "project" },
        ],
        truncated: true,
      }),
    });
    const call = await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(call.system).toContain("索引超注入预算已截断");
    expect(call.system).toContain("entry-a");
  });

  it("提取 pass：压缩判定通过后、压缩执行前调用（runs 为压缩前原文）；同纪元不重复", async () => {
    const calls: { runs: number; afterCompact: boolean }[] = [];
    let compactCount = 0;
    let compactBudget = 1; // 首次压缩成功，之后 shouldCompact 仍真但 compact 不再收效
    const compacting: AgentCapability = {
      ...capability,
      compactPolicies: [
        {
          shouldCompact: () => true,
          compact: async (loop) => {
            if (compactBudget <= 0) return false;
            compactBudget--;
            compactCount++;
            for (const run of loop.runs) run.messages.length = 0;
            return true;
          },
        },
      ],
    };
    const ctx = new LoopContext({
      agentCapability: compacting,
      workspace: "/ws",
      preCompactPass: async (_sampling, runs) => {
        calls.push({ runs: runs.length, afterCompact: compactCount > 0 });
      },
    });
    ctx.appendRun(makeRun("第一轮"));
    await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.runs).toBe(1); // 压缩前原文（run 仍在）
    expect(calls[0]!.afterCompact).toBe(false); // 先于 compact 执行
    // 新纪元（上次压缩后 compactionCount 已 +1）允许再次执行；压缩不再收效后
    // 纪元不再前进 → 同纪元内不重复执行（防阈值反复触发的骚扰）
    ctx.appendRun(makeRun("第二轮"));
    await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(calls).toHaveLength(2);
    ctx.appendRun(makeRun("第三轮"));
    await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(calls).toHaveLength(2);
  });

  it("提取 pass 未装配 / 判定不通过：不调用，压缩照常", async () => {
    const pass = async (): Promise<void> => {
      throw new Error("不应调用");
    };
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      preCompactPass: pass,
    });
    ctx.appendRun(makeRun());
    const call = await ctx.toProviderCall({ sampling: { model: "m" } }, RUN_PROGRESS);
    expect(call.system).toContain("小说全局约束");
    expect(ctx.compactionGeneration).toBe(0);
  });
});
