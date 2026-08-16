import { describe, it, expect } from "vitest";
import { AgentLoop } from "../AgentLoop.js";
import { LoopContext } from "../LoopContext.js";
import { ProviderRequestError } from "../../provider/errors.js";
import type { Provider } from "../../provider/Provider.js";
import type { ProviderCall, ProviderResult } from "../../provider/types.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDispatcher } from "../../tool/ToolDispatcher.js";
import type { LoopEvent } from "../types.js";
import type { ContextCompactPolicy } from "../../compact/ContextCompactPolicy.js";

const capability: AgentCapability = {
  systemSections: [
    { kind: "static", id: "base.one", version: "1.0.0", label: "Base One", render: () => "你是助手" },
  ],
  toolDefs: [],
  nudgePolicies: [],
  compactPolicies: [],
};

const dispatcher: ToolDispatcher = {
  dispatch: async (_ctx, call) => `result:${call.name}`,
  resolve: () => undefined,
};

/** 计数型压缩策略：compact 时清空除最近一条外的全部消息（模拟压缩生效） */
function countingPolicy(state: { forces: number[]; normal: number }) {
  return {
    shouldCompact: () => false, // 阈值路径不触发（走保险丝 force 路径）
    compact: async (loop: LoopContext, opts?: { force?: boolean }) => {
      if (opts?.force) state.forces.push(loop.runs.length);
      else state.normal++;
      return true;
    },
  } as unknown as ContextCompactPolicy;
}

describe("AgentLoop 压缩链路与保险丝", () => {
  it("restoreRuns 按 run 边界恢复，seq 对齐到最大值（压缩分区跨重启保持）", () => {
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      restoreRuns: [
        { seq: 1, messages: [{ role: "user", content: "开篇意图" }] },
        { seq: 5, messages: [{ role: "user", content: "<context-summary>\n旧摘要\n</context-summary>" }] },
        { seq: 6, messages: [{ role: "user", content: "新问题" }] },
      ],
      startSeq: 3,
    });
    expect(ctx.runs.map((r) => r.seq)).toEqual([1, 5, 6]);
    expect(ctx.messages.map((m) => m.content)).toEqual(["开篇意图", "<context-summary>\n旧摘要\n</context-summary>", "新问题"]);
    expect(ctx.allocateSeq()).toBe(7);
  });

  it("toProviderCall 触发压缩 → 发射 compacted 事件（persist）", async () => {
    const policy = {
      shouldCompact: () => true,
      compact: async () => true,
    } as unknown as ContextCompactPolicy;
    const provider: Provider = {
      call: async (): Promise<ProviderResult> => ({
        finishReason: "stop",
        message: { role: "assistant", content: "ok" },
        usage: { inputTokens: 10, outputTokens: 1 },
      }),
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: { ...capability, compactPolicies: [policy] },
      toolDispatcher: dispatcher,
    });
    const events: LoopEvent[] = [];
    loop.onOutputEvent((e) => events.push(e));
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    const compacted = events.filter((e) => e.type === "compacted");
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({ persist: true });
  });

  it("context-length 错误 → forceCompact + 重组装重试一次成功", async () => {
    const state = { forces: [] as number[], normal: 0 };
    let calls = 0;
    const provider: Provider = {
      call: async (): Promise<ProviderResult> => {
        calls++;
        if (calls === 1) {
          throw new ProviderRequestError(
            "prompt is too long: 1000000 tokens > maximum context length",
            { status: 400 },
          );
        }
        return {
          finishReason: "stop",
          message: { role: "assistant", content: "恢复成功" },
        };
      },
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: { ...capability, compactPolicies: [countingPolicy(state)] },
      toolDispatcher: dispatcher,
    });
    const events: LoopEvent[] = [];
    loop.onOutputEvent((e) => events.push(e));
    const result = await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(result.final.content).toBe("恢复成功");
    expect(calls).toBe(2); // 重试了一次
    expect(state.forces).toHaveLength(1); // 保险丝走了 force 路径
    expect(state.normal).toBe(0); // shouldCompact=false：常规路径未触发
    expect(events.filter((e) => e.type === "compacted")).toHaveLength(1);
  });

  it("非超窗错误（认证）不触发保险丝，原样抛出", async () => {
    const state = { forces: [] as number[], normal: 0 };
    const provider: Provider = {
      call: async (): Promise<ProviderResult> => {
        throw new ProviderRequestError("invalid api key", { status: 401 });
      },
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: { ...capability, compactPolicies: [countingPolicy(state)] },
      toolDispatcher: dispatcher,
    });
    await expect(loop.run("hi", { sampling: { model: "gpt-5" } })).rejects.toThrow("invalid api key");
    expect(state.forces).toHaveLength(0);
  });
});
