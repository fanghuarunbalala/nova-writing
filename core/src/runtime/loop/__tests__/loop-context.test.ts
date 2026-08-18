import { describe, it, expect, vi } from "vitest";
import { LoopContext } from "../LoopContext.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { RunContext } from "../types.js";

const capability: AgentCapability = {
  systemSections: [
    { kind: "static", id: "base.one", version: "1.0.0", label: "Base One", render: () => "你是助手" },
  ],
  toolDefs: [{ name: "read", version: "1", handler: { execute: async () => "" } }],
  compactPolicies: [],
  nudgePolicies: [],
};

/** 多 static 段 + dynamic 段能力（缓存短路 bug 回归用） */
const multiSectionCapability: AgentCapability = {
  systemSections: [
    { kind: "static", id: "a.one", version: "1.0.0", label: "A", render: () => "段A" },
    { kind: "static", id: "b.two", version: "1.0.0", label: "B", render: () => "段B" },
    { kind: "static", id: "c.three", version: "1.0.0", label: "C", render: () => "段C" },
    {
      kind: "dynamic",
      id: "d.env",
      version: "1.0.0",
      label: "D",
      renderDynamic: (input) =>
        input.environment === undefined ? "" : `环境:${input.environment.workdir}:${input.environment.modelId ?? ""}`,
    },
  ],
  toolDefs: [],
  compactPolicies: [],
  nudgePolicies: [],
};

function makeRun(messages: Array<{ role: string; content: string }> = []): RunContext {
  const msgs = messages as RunContext["messages"];
  return {
    seq: 0,
    messages: msgs,
    ts: "t",
    appendRunMessages: (m) => {
      msgs.push(...m);
    },
  };
}

describe("LoopContext", () => {
  it("appendRun 开 turn：seq 分配 + onRunAppended", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const onAppended = vi.fn();
    ctx.subscribe({ onRunAppended: onAppended });
    ctx.appendRun(makeRun());
    expect(ctx.runs).toHaveLength(1);
    expect(ctx.runs[0].seq).toBe(1);
    expect(onAppended).toHaveBeenCalledOnce();
  });

  it("startSeq 恢复：恢复 turn 沿用 journal 最后 seq（暂停点续跑同 seq 重写），新 turn 从 +1 起", () => {
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      runMessages: [{ role: "user", content: "历史" }, { role: "assistant", content: "回复" }],
      startSeq: 5,
    });
    // 恢复 turn 沿用 seq 5（不消耗新号：补完消息同 seq 重写原快照）
    expect(ctx.runs).toHaveLength(1);
    expect(ctx.runs[0].seq).toBe(5);
    // 新 turn 从 6 起
    ctx.appendRun(makeRun());
    expect(ctx.runs.at(-1)!.seq).toBe(6);
  });

  it("appendRunMessages 追加当前 turn + onRunMessageAppend", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const onAppend = vi.fn();
    ctx.subscribe({ onRunMessageAppend: onAppend });
    ctx.appendRun(makeRun([{ role: "user", content: "hi" }]));
    ctx.appendRunMessages([{ role: "assistant", content: "ok" }]);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[1].content).toBe("ok");
    expect(onAppend).toHaveBeenCalledOnce();
  });

  it("subscribe 支持多监听器", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const a = vi.fn();
    const b = vi.fn();
    ctx.subscribe({ onRunAppended: a });
    ctx.subscribe({ onRunAppended: b });
    ctx.appendRun(makeRun());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("getters：systemPrompt 渲染 / toolSchemes / workspace", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    expect(ctx.systemPrompt).toContain("你是助手");
    expect(ctx.toolSchemes).toHaveLength(1);
    expect(ctx.workspace).toBe("/ws");
  });

  it("toProviderCall 组装基础请求", async () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    ctx.appendRun(makeRun([{ role: "user", content: "hi" }]));
    const call = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call.system).toContain("你是助手");
    expect(call.messages).toHaveLength(1);
    expect(call.sampling.model).toBe("gpt-5");
  });

  it("缓存回归：多 static 段各自渲染一次按序进入 prompt（不短路为首段内容）", async () => {
    const ctx = new LoopContext({ agentCapability: multiSectionCapability, workspace: "/ws" });
    const call = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    // 三段各出现一次（旧实现：段B/段C 被段A 内容替换，不会出现）
    expect(call.system).toContain("段A");
    expect(call.system).toContain("段B");
    expect(call.system).toContain("段C");
    // 块序保持能力声明顺序
    const idxA = call.system.indexOf("段A");
    const idxB = call.system.indexOf("段B");
    const idxC = call.system.indexOf("段C");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it("dynamic 段每调用渲染：workdir 取 workspace / modelId 取 sampling.model / platform 构造注入", async () => {
    const ctx = new LoopContext({
      agentCapability: multiSectionCapability,
      workspace: "/ws",
      platform: "win32",
    });
    const call = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call.system).toContain("环境:/ws:gpt-5");
    // 未注入 platform：环境块整段省略
    const bare = new LoopContext({ agentCapability: multiSectionCapability, workspace: "/ws" });
    const bareCall = await bare.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(bareCall.system).not.toContain("环境:");
  });

  it("novelConstraintsProvider 每调用注入：约束内容进 dynamic 段；未注入省略", async () => {
    const constraintsCapability: AgentCapability = {
      systemSections: [
        {
          kind: "dynamic",
          id: "g.con",
          version: "1.0.0",
          label: "G",
          renderDynamic: (input) =>
            input.novelGlobalConstraints === undefined
              ? ""
              : `约束:${input.novelGlobalConstraints.content}`,
        },
      ],
      toolDefs: [],
      compactPolicies: [],
      nudgePolicies: [],
    };
    let reads = 0;
    const ctx = new LoopContext({
      agentCapability: constraintsCapability,
      workspace: "/ws",
      novelConstraintsProvider: async () => ({ fileName: "NOVEL.md", content: `v${++reads}` }),
    });
    const call1 = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call1.system).toContain("约束:v1");
    // 每 provider call 重新读取（NOVEL.md 改动即时生效）
    const call2 = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call2.system).toContain("约束:v2");
    // 未注入 provider（返回 undefined）：dynamic 段省略
    const bare = new LoopContext({ agentCapability: constraintsCapability, workspace: "/ws" });
    const bareCall = await bare.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(bareCall.system).not.toContain("约束:");
  });

  it("composeGuideProvider 每调用注入：索引进 dynamic 段；未注入省略（PRD compose-案例引导）", async () => {
    const guideCapability: AgentCapability = {
      systemSections: [
        {
          kind: "dynamic",
          id: "g.guide",
          version: "1.0.0",
          label: "G",
          renderDynamic: (input) =>
            input.composeGuide === undefined ? "" : `引导:${input.composeGuide.index}`,
        },
      ],
      toolDefs: [],
      compactPolicies: [],
      nudgePolicies: [],
    };
    let reads = 0;
    const ctx = new LoopContext({
      agentCapability: guideCapability,
      workspace: "/ws",
      composeGuideProvider: async () => ({ index: `v${++reads}`, casesDir: ".novel/cases" }),
    });
    const call1 = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call1.system).toContain("引导:v1");
    // 每 provider call 重新读取（.novel/cases 变更即时生效）
    const call2 = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call2.system).toContain("引导:v2");
    // 未注入 provider：dynamic 段省略
    const bare = new LoopContext({ agentCapability: guideCapability, workspace: "/ws" });
    const bareCall = await bare.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(bareCall.system).not.toContain("引导:");
  });

  it("systemPrompt getter：返回最近一次渲染值；未渲染时以空输入渲染", async () => {
    const ctx = new LoopContext({
      agentCapability: multiSectionCapability,
      workspace: "/ws",
      platform: "win32",
    });
    // 未渲染：以空输入渲染 → 只有 static 段，无环境块
    expect(ctx.systemPrompt).toContain("段A");
    expect(ctx.systemPrompt).not.toContain("环境:");
    // 渲染后：最近一次渲染值（含环境块）
    await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(ctx.systemPrompt).toContain("环境:/ws:gpt-5");
  });

  it("beforeProviderCall：toProviderCall 步骤⓪ 先于 nudge 执行（async 支持）", async () => {
    const order: string[] = [];
    const nudgeCapability: AgentCapability = {
      ...capability,
      nudgePolicies: [
        {
          persistentNudgeIfNeeded: () => {
            order.push("persistent");
            return false;
          },
          transientNudgeIfNeeded: () => {
            order.push("transient");
            return false;
          },
        },
      ],
    };
    let resolved = false;
    const ctx = new LoopContext({
      agentCapability: nudgeCapability,
      workspace: "/ws",
      beforeProviderCall: async () => {
        await Promise.resolve();
        resolved = true;
        order.push("before");
      },
    });
    await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(resolved).toBe(true);
    expect(order).toEqual(["before", "persistent", "transient"]);
  });

  it("beforeProviderCall 未注入：toProviderCall 照常工作（no-op）", async () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const call = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call.sampling.model).toBe("gpt-5");
  });

  it("compactionGeneration：实际压缩 +1，未压缩不变", async () => {
    const compactCapability: AgentCapability = {
      ...capability,
      compactPolicies: [
        {
          shouldCompact: () => true,
          compact: async () => true,
        },
      ],
    };
    const ctx = new LoopContext({ agentCapability: compactCapability, workspace: "/ws" });
    ctx.appendRun(makeRun([{ role: "user", content: "hi" }]));
    expect(ctx.compactionGeneration).toBe(0);
    await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(ctx.compactionGeneration).toBe(1);
    // 无压缩策略：代数恒 0
    const bare = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    bare.appendRun(makeRun([{ role: "user", content: "hi" }]));
    await bare.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(bare.compactionGeneration).toBe(0);
  });

  it("persistent nudge 先于消息快照：本 call 即可见（注入紧贴用户消息）", async () => {
    const nudgeCapability: AgentCapability = {
      ...capability,
      nudgePolicies: [
        {
          persistentNudgeIfNeeded: (loop) => {
            loop.appendRunMessages([{ role: "system", content: "【项目状态】…" }]);
            return true;
          },
          transientNudgeIfNeeded: () => false,
        },
      ],
    };
    const ctx = new LoopContext({ agentCapability: nudgeCapability, workspace: "/ws" });
    ctx.appendRun(makeRun([{ role: "user", content: "hi" }]));
    const call = await ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call.messages.map((m) => m.content)).toEqual(["hi", "【项目状态】…"]);
  });

  it("压缩后清扫：带 nudge 标记的 system 被删，无标记 system 保留（forceCompact 与 toProviderCall 两路径）", async () => {
    const compactCapability: AgentCapability = {
      ...capability,
      compactPolicies: [
        {
          shouldCompact: () => true,
          compact: async () => true,
        },
      ],
    };
    const mk = async (viaForce: boolean) => {
      const ctx = new LoopContext({ agentCapability: compactCapability, workspace: "/ws" });
      ctx.appendRun(
        makeRun([
          { role: "user", content: "hi" },
          { role: "system", content: "【项目状态】…", nudge: "project_stage_sparse" } as never,
          { role: "system", content: "工作流全文", nudge: "project_stage_full" } as never,
          { role: "system", content: "# 设计模式（Compose Mode）" },
          { role: "assistant", content: "ok" },
        ]),
      );
      if (viaForce) {
        await ctx.forceCompact();
      } else {
        await ctx.toProviderCall(
          { sampling: { model: "gpt-5" } },
          { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
        );
      }
      return ctx.messages.map((m) => m.content);
    };
    for (const viaForce of [true, false]) {
      const contents = await mk(viaForce);
      expect(contents).toEqual(["hi", "# 设计模式（Compose Mode）", "ok"]);
    }
  });
});
