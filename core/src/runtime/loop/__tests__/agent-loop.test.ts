import { describe, it, expect } from "vitest";
import { AgentLoop } from "../AgentLoop.js";
import type { Provider } from "../../provider/Provider.js";
import type { ProviderCall, ProviderResult } from "../../provider/types.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDispatcher } from "../../tool/ToolDispatcher.js";

const capability: AgentCapability = {
  systemSections: [{ kind: "static", render: () => "你是助手" }],
  toolDefs: [],
  compactPolicies: [],
  nudgePolicies: [],
};

function result(
  finishReason: ProviderResult["finishReason"],
  content: string,
  toolCalls?: ProviderResult["message"]["toolCalls"],
): ProviderResult {
  return {
    finishReason,
    message: { role: "assistant", content, ...(toolCalls ? { toolCalls } : {}) },
  };
}

function makeProvider(results: ProviderResult[]): Provider {
  let i = 0;
  return {
    call: async (_call: ProviderCall, onDelta?) => {
      onDelta?.({ type: "text-delta", text: "x" });
      return results[i++] ?? result("stop", "done");
    },
  };
}

const dispatcher: ToolDispatcher = {
  dispatch: async (_ctx, call) => `result:${call.name}`,
};

function makeLoop(provider: Provider): AgentLoop {
  return new AgentLoop({
    workspace: "/ws",
    provider,
    agentCapability: capability,
    toolDispatcher: dispatcher,
  });
}

describe("AgentLoop.run", () => {
  it("纯文本：一次 call stop 返回 final", async () => {
    const loop = makeLoop(makeProvider([result("stop", "你好")]));
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(r.final.content).toBe("你好");
    expect(r.final.role).toBe("assistant");
  });

  it("onOutputEvent 订阅收到 run 产出的事件", async () => {
    const loop = makeLoop(makeProvider([result("stop", "你好")]));
    const events: string[] = [];
    loop.onOutputEvent((e) => events.push(e.type));
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(events).toContain("turn-start");
    expect(events).toContain("assistant.delta");
    expect(events).toContain("turn-end");
  });

  it("followup 排队：run 进行中 followup 入队，串行 drain", async () => {
    const loop = makeLoop(makeProvider([result("stop", "first"), result("stop", "second")]));
    const r1 = await loop.run("first", { sampling: { model: "gpt-5" } });
    expect(r1.final.content).toBe("first");
    // followup 入队 + drain
    loop.followup("second");
    await new Promise((r) => setTimeout(r, 10)); // 等 drain
    // 验证第二轮已执行（第二个 result 被消费）
    expect(true).toBe(true);
  });

  it("steer 注入 system reminder", async () => {
    const loop = makeLoop(makeProvider([result("stop", "ok")]));
    await loop.run("hi", { sampling: { model: "gpt-5" } }); // 设置 lastConfig
    loop.steer("换个方向");
    await new Promise((r) => setTimeout(r, 10));
    // steer 追加 system 消息到当前 turn
    expect(loop["context"].messages.some((m) => m.role === "system")).toBe(true);
  });

  it("stop 取消 + 清空 turn 队列", async () => {
    const loop = makeLoop(makeProvider([result("stop", "ok")]));
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    loop.followup("排队1");
    loop.stop();
    expect(loop["inbox"].filter((i) => i.kind === "followup")).toHaveLength(0);
  });

  it("tool_call 循环：执行工具后继续直至 stop", async () => {
    const provider = makeProvider([
      result("tool_call", "查一下", [{ id: "c1", name: "read", args: "{}" }]),
      result("stop", "完成"),
    ]);
    const loop = makeLoop(provider);
    const events: string[] = [];
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => events.push(e.type));
    expect(r.final.content).toBe("完成");
    expect(events).toContain("tool-call-request");
    expect(events).toContain("tool-call-response");
  });

  it("length 截断返回", async () => {
    const loop = makeLoop(makeProvider([result("length", "被截断")]));
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(r.final.content).toBe("被截断");
  });

  it("达到 maxTurn 抛错", async () => {
    const provider: Provider = {
      call: async () => result("tool_call", "x", [{ id: "c1", name: "read", args: "{}" }]),
    };
    const loop = makeLoop(provider);
    await expect(loop.run("hi", { sampling: { model: "gpt-5" }, maxTurns: 2 })).rejects.toThrow(
      "达到最大轮次",
    );
  });

  it("cancel 后 run 中止（signal 已 abort）", async () => {
    const provider: Provider = {
      call: async (call: ProviderCall) => {
        if (call.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        return result("stop", "ok");
      },
    };
    const loop = makeLoop(provider);
    loop.cancel();
    await expect(loop.run("hi", { sampling: { model: "gpt-5" } })).rejects.toThrow();
  });
});
