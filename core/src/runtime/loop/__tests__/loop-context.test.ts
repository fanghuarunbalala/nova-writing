import { describe, it, expect, vi } from "vitest";
import { LoopContext } from "../LoopContext.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { TurnContext } from "../types.js";

const capability: AgentCapability = {
  systemSections: [{ kind: "static", render: () => "你是助手" }],
  toolDefs: [{ name: "read", version: "1", handler: { execute: async () => "" } }],
  compactPolicies: [],
  nudgePolicies: [],
};

function makeTurn(messages: Array<{ role: string; content: string }> = []): TurnContext {
  const msgs = messages as TurnContext["messages"];
  return {
    seq: 0,
    messages: msgs,
    ts: "t",
    appendTurnMessages: (m) => {
      msgs.push(...m);
    },
  };
}

describe("LoopContext", () => {
  it("appendTurnContext 开 turn：seq 分配 + onTurnAppended", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const onAppended = vi.fn();
    ctx.subscribe({ onTurnAppended: onAppended });
    ctx.appendTurnContext(makeTurn());
    expect(ctx.turns).toHaveLength(1);
    expect(ctx.turns[0].seq).toBe(1);
    expect(onAppended).toHaveBeenCalledOnce();
  });

  it("startSeq 恢复：journal 重放后新 turn 从 resumeSeq+1 开始（合成恢复 turn 消耗一号）", () => {
    const ctx = new LoopContext({
      agentCapability: capability,
      workspace: "/ws",
      turnMessages: [{ role: "user", content: "历史" }, { role: "assistant", content: "回复" }],
      startSeq: 5,
    });
    // 合成恢复 turn 占 seq 6
    expect(ctx.turns).toHaveLength(1);
    expect(ctx.turns[0].seq).toBe(6);
    // 新 turn 从 7 起
    ctx.appendTurnContext(makeTurn());
    expect(ctx.turns.at(-1)!.seq).toBe(7);
  });

  it("appendTurnMessages 追加当前 turn + onTurnMessageAppend", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const onAppend = vi.fn();
    ctx.subscribe({ onTurnMessageAppend: onAppend });
    ctx.appendTurnContext(makeTurn([{ role: "user", content: "hi" }]));
    ctx.appendTurnMessages([{ role: "assistant", content: "ok" }]);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[1].content).toBe("ok");
    expect(onAppend).toHaveBeenCalledOnce();
  });

  it("subscribe 支持多监听器", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    const a = vi.fn();
    const b = vi.fn();
    ctx.subscribe({ onTurnAppended: a });
    ctx.subscribe({ onTurnAppended: b });
    ctx.appendTurnContext(makeTurn());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("getters：systemPrompt 渲染 / toolSchemes / workspace", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    expect(ctx.systemPrompt).toContain("你是助手");
    expect(ctx.toolSchemes).toHaveLength(1);
    expect(ctx.workspace).toBe("/ws");
  });

  it("toProviderCall 组装基础请求", () => {
    const ctx = new LoopContext({ agentCapability: capability, workspace: "/ws" });
    ctx.appendTurnContext(makeTurn([{ role: "user", content: "hi" }]));
    const call = ctx.toProviderCall(
      { sampling: { model: "gpt-5" } },
      { curTurn: 0, maxTurn: 5, toolsLastTurn: new Map() },
    );
    expect(call.system).toContain("你是助手");
    expect(call.messages).toHaveLength(1);
    expect(call.sampling.model).toBe("gpt-5");
  });
});
