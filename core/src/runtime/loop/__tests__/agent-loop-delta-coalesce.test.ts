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

describe("AgentLoop reasoning 心跳（无内容、1s 节流、正文开始即取消）", () => {
  /** 全量事件里挑出 reasoning 心跳 */
  function heartbeats(events: LoopEvent[]): { chars: number; text: string }[] {
    return events
      .filter(
        (e): e is Extract<LoopEvent, { type: "assistant.delta" }> =>
          e.type === "assistant.delta" && e.kind === "reasoning",
      )
      .map((e) => ({ chars: e.chars ?? -1, text: e.text }));
  }

  it("1s 窗口合并：连续 reasoning chunk → 至多 1 条/秒、chars 为累计值、text 恒空", async () => {
    vi.useFakeTimers();
    try {
      const provider: Provider = {
        call: async (
          _call: ProviderCall,
          onDelta?: (d: { type: "text-delta" | "reasoning-delta"; text: string }) => void,
        ) => {
          // ~3 秒思考，每 90ms 一个 chunk（每个 10 字符，避开 1s 边界巧合）
          for (let i = 0; i < 33; i++) {
            onDelta?.({ type: "reasoning-delta", text: "0123456789" });
            await vi.advanceTimersByTimeAsync(90);
          }
          return stopResult("ok");
        },
      };
      const loop = makeLoop(provider);
      const events: LoopEvent[] = [];
      const running = loop.run("hi", { sampling: { model: "m" } }, (e) => events.push(e));
      await vi.advanceTimersByTimeAsync(200);
      await running;
      const beats = heartbeats(events);
      // ~2.97s 思考 → 2-3 条心跳（turn 收口时未到期的尾窗心跳被取消，属预期）
      expect(beats.length).toBeGreaterThanOrEqual(2);
      expect(beats.length).toBeLessThanOrEqual(3);
      for (const b of beats) expect(b.text).toBe("");
      // 累计语义：chars 单调不减（每条心跳 = 当时的累计字符数）
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i]!.chars).toBeGreaterThan(beats[i - 1]!.chars);
      }
      expect(beats[0]!.chars).toBeGreaterThanOrEqual(90);
      // 思考内容零上链：本 turn 无正文 → 除心跳外无任何 text delta
      const textDeltas = events.filter(
        (e): e is Extract<LoopEvent, { type: "assistant.delta" }> =>
          e.type === "assistant.delta" && e.kind !== "reasoning",
      );
      expect(textDeltas).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("正文开始 → 心跳取消（不残留 thinking 回跳），text delta 正常发射", async () => {
    vi.useFakeTimers();
    try {
      const provider: Provider = {
        call: async (
          _call: ProviderCall,
          onDelta?: (d: { type: "text-delta" | "reasoning-delta"; text: string }) => void,
        ) => {
          onDelta?.({ type: "reasoning-delta", text: "x".repeat(50) });
          await vi.advanceTimersByTimeAsync(300); // 心跳窗口内（<1s 未触发）
          onDelta?.({ type: "text-delta", text: "正文" });
          await vi.advanceTimersByTimeAsync(2000); // 原 1s 心跳到期点
          return stopResult("正文");
        },
      };
      const loop = makeLoop(provider);
      const events: LoopEvent[] = [];
      const running = loop.run("hi", { sampling: { model: "m" } }, (e) => events.push(e));
      await vi.advanceTimersByTimeAsync(300);
      await running;
      expect(heartbeats(events)).toHaveLength(0); // 取消于首个 text delta
      const textDeltas = events.filter(
        (e): e is Extract<LoopEvent, { type: "assistant.delta" }> =>
          e.type === "assistant.delta" && e.kind !== "reasoning",
      );
      expect(textDeltas.map((e) => e.text)).toEqual(["正文"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("跨 turn 重置：第二轮思考从 0 重新计数", async () => {
    vi.useFakeTimers();
    try {
      let turn = 0;
      const provider: Provider = {
        call: async (
          _call: ProviderCall,
          onDelta?: (d: { type: "text-delta" | "reasoning-delta"; text: string }) => void,
        ) => {
          turn += 1;
          if (turn === 1) {
            onDelta?.({ type: "reasoning-delta", text: "y".repeat(1000) });
            await vi.advanceTimersByTimeAsync(1100); // 首轮心跳触发
            return toolCallResult();
          }
          onDelta?.({ type: "reasoning-delta", text: "z".repeat(80) });
          await vi.advanceTimersByTimeAsync(1100); // 次轮心跳触发
          return stopResult("done");
        },
      };
      const loop = makeLoop(provider);
      const events: LoopEvent[] = [];
      const running = loop.run("hi", { sampling: { model: "m" } }, (e) => events.push(e));
      await vi.advanceTimersByTimeAsync(300);
      await running;
      const beats = heartbeats(events);
      expect(beats[0]!.chars).toBe(1000);
      expect(beats.at(-1)!.chars).toBe(80); // 重置后重新累计
    } finally {
      vi.useRealTimers();
    }
  });
});
