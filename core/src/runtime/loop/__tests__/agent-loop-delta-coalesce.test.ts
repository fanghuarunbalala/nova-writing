/**
 * AgentLoop text-delta 合并测试（gui-performance-2 功能点一）：
 * 同窗口合并为一条事件、跨窗口分段、非 delta 事件发射前强制冲刷保序、错误路径收口前冲刷。
 */
import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../AgentLoop.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import type { Provider, ProviderCall, ProviderResult } from "../../provider/types.js";
import type { LoopEvent } from "../types.js";

function stopResult(content: string): ProviderResult {
  return { finishReason: "stop", message: { role: "assistant", content } };
}

function toolCallResult(): ProviderResult {
  return {
    finishReason: "tool_call",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t1", name: "NovelRead", args: "{}" }],
    },
  };
}

/** 免审读工具 */
const readTool: ToolDef = {
  name: "NovelRead",
  version: "1.0.0",
  requireApproval: false,
  handler: { execute: async () => "ok" },
};

function makeLoop(provider: Provider): AgentLoop {
  const capability: AgentCapability = {
    systemSections: [],
    toolDefs: [readTool],
    nudgePolicies: [],
    compactPolicies: [],
  };
  return new AgentLoop({
    workspace: "/ws",
    provider,
    agentCapability: capability,
    toolDispatcher: {
      dispatch: async (_ctx, call) => `result:${call.name}`,
      resolve: (name) => (name === "NovelRead" ? readTool : undefined),
    },
    conversationId: "c1",
  });
}

describe("AgentLoop text-delta 合并", () => {
  it("同窗口多 chunk → 收口时一条合并 delta，且先于 assistant.message", async () => {
    const provider: Provider = {
      call: async (_call: ProviderCall, onDelta?: (d: { type: "text-delta"; text: string }) => void) => {
        for (const t of ["你", "好", "，", "世", "界"]) onDelta?.({ type: "text-delta", text: t });
        return stopResult("你好，世界");
      },
    };
    const loop = makeLoop(provider);
    const types: string[] = [];
    const deltaTexts: string[] = [];
    await loop.run("hi", { sampling: { model: "m" } }, (e: LoopEvent) => {
      types.push(e.type);
      if (e.type === "assistant.delta") deltaTexts.push(e.text);
    });
    expect(deltaTexts).toEqual(["你好，世界"]);
    expect(types.indexOf("assistant.delta")).toBeLessThan(types.indexOf("assistant.message"));
    // 缓冲已清空：不再有待冲刷内容（后续事件不重复携带旧文本）
    expect(types.filter((t) => t === "assistant.delta")).toHaveLength(1);
  });

  it("跨 32ms 窗口分段：分散到达的 delta 至少两条事件，拼接无损", async () => {
    vi.useFakeTimers();
    try {
      const provider: Provider = {
        call: async (_call: ProviderCall, onDelta?: (d: { type: "text-delta"; text: string }) => void) => {
          for (const t of ["a", "b", "c"]) {
            onDelta?.({ type: "text-delta", text: t });
            await vi.advanceTimersByTimeAsync(40); // 每段间隔 > 32ms 窗口
          }
          return stopResult("abc");
        },
      };
      const loop = makeLoop(provider);
      const deltaTexts: string[] = [];
      const running = loop.run("hi", { sampling: { model: "m" } }, (e: LoopEvent) => {
        if (e.type === "assistant.delta") deltaTexts.push(e.text);
      });
      await vi.advanceTimersByTimeAsync(300);
      await running;
      expect(deltaTexts.length).toBeGreaterThanOrEqual(2);
      expect(deltaTexts.join("")).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("保序：缓冲未冲刷时返回 tool_call → 合并 delta 先于 tool-call-request", async () => {
    let first = true;
    const provider: Provider = {
      call: async (_call: ProviderCall, onDelta?: (d: { type: "text-delta"; text: string }) => void) => {
        onDelta?.({ type: "text-delta", text: "我先想一想" });
        if (first) {
          first = false;
          return toolCallResult();
        }
        return stopResult("done");
      },
    };
    const loop = makeLoop(provider);
    const types: string[] = [];
    await loop.run("hi", { sampling: { model: "m" } }, (e: LoopEvent) => types.push(e.type));
    expect(types.indexOf("assistant.delta")).toBeGreaterThan(-1);
    expect(types.indexOf("assistant.delta")).toBeLessThan(types.indexOf("tool-call-request"));
    expect(types[types.indexOf("tool-call-request") - 1]).toBe("assistant.delta");
  });

  it("错误路径（followup）：provider 抛错 → 缓冲文本先于「生成失败」assistant.message 发出", async () => {
    const provider: Provider = {
      call: async (_call: ProviderCall, onDelta?: (d: { type: "text-delta"; text: string }) => void) => {
        onDelta?.({ type: "text-delta", text: "写到一半" });
        throw new Error("boom");
      },
    };
    const loop = makeLoop(provider);
    const types: string[] = [];
    const deltaTexts: string[] = [];
    loop.onOutputEvent((e) => {
      types.push(e.type);
      if (e.type === "assistant.delta") deltaTexts.push(e.text);
    });
    // followup 路径（无 resolveId）：异常收口为「生成失败」assistant.message + run-end 事件
    loop.followup("hi", { sampling: { model: "m" } });
    await vi.waitFor(() => {
      expect(types[types.length - 1]).toBe("run-end");
    });
    expect(deltaTexts).toEqual(["写到一半"]);
    expect(types.indexOf("assistant.delta")).toBeLessThan(types.indexOf("assistant.message"));
  });
});
