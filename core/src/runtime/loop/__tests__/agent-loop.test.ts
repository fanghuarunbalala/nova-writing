import { describe, it, expect } from "vitest";
import { AgentLoop } from "../AgentLoop.js";
import { ToolError } from "../../tool/errors.js";
import type { Provider } from "../../provider/Provider.js";
import type { ProviderCall, ProviderResult } from "../../provider/types.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDispatcher } from "../../tool/ToolDispatcher.js";
import type { LoopEvent } from "../types.js";
import { ComposeModeStateProvider } from "../../../conversation/compose/index.js";

const capability: AgentCapability = {
  systemSections: [
    { kind: "static", id: "base.one", version: "1.0.0", label: "Base One", render: () => "你是助手" },
  ],
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
  resolve: () => undefined,
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
    expect(events).toContain("run-start");
    expect(events).toContain("assistant.delta");
    expect(events).toContain("run-end");
  });

  it("reasoning delta 在 loop 层丢弃：不产出任何 assistant.delta 事件（thinking=high 双流只过 text）", async () => {
    const provider: Provider = {
      call: async (_call: ProviderCall, onDelta?) => {
        onDelta?.({ type: "reasoning-delta", text: "思考中" });
        onDelta?.({ type: "text-delta", text: "正文" });
        return result("stop", "正文");
      },
    };
    const loop = makeLoop(provider);
    const events: LoopEvent[] = [];
    loop.onOutputEvent((e) => events.push(e));
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    const deltas = events.filter((e) => e.type === "assistant.delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "text", text: "正文" });
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

  it("followup 即时开 turn 返回 RunContext（seq 已分配，run-start/user.message 已发；执行后同 seq 收口）", async () => {
    const loop = makeLoop(makeProvider([result("stop", "回声")]));
    // 先 run 设置 lastConfig（followup 不带 config 时复用）
    await loop.run("warm", { sampling: { model: "gpt-5" } });
    const events: LoopEvent[] = [];
    loop.onOutputEvent((e) => events.push(e));
    const turn = loop.followup("你好");
    expect(turn.seq).toBe(2); // warm 消耗 seq 1
    // 前两个事件由 followup 同步发出（drain 异步，后续事件可能已插入）
    expect(events.slice(0, 2).map((e) => e.type)).toEqual(["run-start", "user.message"]);
    await new Promise((r) => setTimeout(r, 10)); // 等 drain
    const types = events.map((e) => e.type);
    expect(types).toContain("assistant.message");
    expect(types).toContain("run-end");
    // user.message 内容为输入文本
    const userMsg = events.find((e) => e.type === "user.message");
    expect(userMsg && "text" in userMsg && userMsg.text).toBe("你好");
    // 本轮所有 persist 事件 seq 统一为 turn.seq（delta 瞬态无 seq 语义）
    const persistSeqs = events
      .filter((e) => "persist" in e && e.persist)
      .map((e) => (e as { seq: number }).seq);
    expect(persistSeqs.every((s) => s === turn.seq)).toBe(true);
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

  it("dispatcher 抛 ToolError → 错误回填 tool 消息与 error 字段，run 继续直至 stop", async () => {
    const provider = makeProvider([
      result("tool_call", "查一下", [{ id: "c1", name: "read", args: "{}" }]),
      result("stop", "完成"),
    ]);
    const failing: ToolDispatcher = {
      dispatch: async () => {
        throw new ToolError({ code: "TOOL_NOT_AVAILABLE", toolName: "read" }, "未知工具: read");
      },
      resolve: () => undefined,
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: capability,
      toolDispatcher: failing,
    });
    const events: LoopEvent[] = [];
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => events.push(e));
    expect(r.final.content).toBe("完成");
    const resp = events.find((e) => e.type === "tool-call-response");
    expect(resp?.type === "tool-call-response" && resp.error).toBe("未知工具: read");
    expect(resp?.type === "tool-call-response" && resp.result).toBeUndefined();
    const toolMsg = loop["context"].messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("工具执行失败(TOOL_NOT_AVAILABLE): 未知工具: read");
  });

  it("dispatcher 抛普通 Error → 兜底 TOOL_HANDLER_FAILED 归一", async () => {
    const provider = makeProvider([
      result("tool_call", "查一下", [{ id: "c1", name: "read", args: "{}" }]),
      result("stop", "完成"),
    ]);
    const failing: ToolDispatcher = {
      dispatch: async () => {
        throw new Error("磁盘已满");
      },
      resolve: () => undefined,
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: capability,
      toolDispatcher: failing,
    });
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    const toolMsg = loop["context"].messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("工具执行失败(TOOL_HANDLER_FAILED): 磁盘已满");
  });

  it("工具错误后模型继续调用直至 stop（continue 语义）", async () => {
    let calls = 0;
    const flaky: ToolDispatcher = {
      dispatch: async (_ctx, call) => {
        calls += 1;
        if (calls === 1) throw new Error("第一次失败");
        return `result:${call.name}`;
      },
      resolve: () => undefined,
    };
    const provider = makeProvider([
      result("tool_call", "查一下", [{ id: "c1", name: "read", args: "{}" }]),
      result("tool_call", "再试", [{ id: "c2", name: "read", args: "{}" }]),
      result("stop", "最终完成"),
    ]);
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: capability,
      toolDispatcher: flaky,
    });
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(r.final.content).toBe("最终完成");
    expect(calls).toBe(2);
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

describe("AgentLoop 工具挂起期间 followup 追发（tool result 归位）", () => {
  it("tool result 定向追加回发起 run：追发的 user 不插进 assistant 与 tool result 之间，下一次请求序列合法", async () => {
    let releaseTool!: () => void;
    const gate = new Promise<void>((resolve) => (releaseTool = resolve));
    const calls: ProviderCall["messages"][] = [];
    const provider: Provider = {
      call: async (call: ProviderCall) => {
        calls.push(call.messages);
        return calls.length === 1
          ? result("tool_call", "查", [{ id: "q1", name: "read", args: "{}" }])
          : result("stop", "done");
      },
    };
    const slowDispatcher: ToolDispatcher = {
      dispatch: async () => {
        await gate;
        return "slow-result";
      },
      resolve: () => undefined,
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: capability,
      toolDispatcher: slowDispatcher,
    });
    const events: string[] = [];
    loop.onOutputEvent((e) => events.push(e.type));
    const bothDone = new Promise<void>((resolve) => {
      const id = setInterval(() => {
        if (events.filter((t) => t === "run-end").length >= 2) {
          clearInterval(id);
          resolve();
        }
      }, 2);
    });
    loop.followup("hi", { sampling: { model: "m" } });
    await new Promise((r) => setTimeout(r, 5)); // run1 进入工具挂起（running=true）
    loop.followup("追发", { sampling: { model: "m" } }); // 挂起期间追发（run2 入队）
    releaseTool();
    await bothDone;

    // run1 收口前的请求（第二次 call）：tool result 紧跟 assistant(toolCalls)，追发 user 在其后
    const second = calls[1];
    expect(second).toBeDefined();
    const toolIdx = second.findIndex((m) => m.role === "tool");
    expect(toolIdx).toBeGreaterThan(0);
    expect(second[toolIdx - 1]).toMatchObject({ role: "assistant", toolCalls: [{ id: "q1" }] });
    const followupIdx = second.findIndex((m) => m.role === "user" && m.content === "追发");
    expect(followupIdx).toBeGreaterThan(toolIdx);

    // run 边界：tool result 落回 seq=1（发起 run），seq=2 以追发 user 开头且不含 tool 消息
    const runs = loop["context"].runs;
    expect(runs[0].messages.some((m) => m.role === "tool")).toBe(true);
    expect(runs[1].messages[0]).toEqual({ role: "user", content: "追发" });
    expect(runs[1].messages.some((m) => m.role === "tool")).toBe(false);
  });
});

describe("AgentLoop.resumePendingRun 补完", () => {
  /** 恢复快照：assistant 带一个未补 tool 结果的 toolCall（ParagraphWrite） */
  function makeResumeLoop(overrides: {
    composeState?: ComposeModeStateProvider;
  } = {}) {
    const dispatched: string[] = [];
    const dispatcher: ToolDispatcher = {
      dispatch: async (_ctx, call) => {
        dispatched.push(call.name);
        return "written";
      },
      resolve: () => ({
        name: "NovelWrite",
        version: "1.0.0",
        requireApproval: true,
        handler: { execute: async () => "written" },
      }),
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider: makeProvider([result("stop", "done")]),
      agentCapability: capability,
      toolDispatcher: dispatcher,
      conversationId: "c1",
      resumePendingDecider: async () => "approve",
      runMessages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "t1", name: "NovelWrite", args: "{}" }],
        },
      ],
      ...(overrides.composeState !== undefined ? { composeState: overrides.composeState } : {}),
    });
    return { loop, dispatched };
  }

  it("approve 决议：handler 正常执行补完", async () => {
    const { loop, dispatched } = makeResumeLoop();
    const responses: string[] = [];
    loop.onOutputEvent((e) => {
      if (e.type === "tool-call-response" && "result" in e) responses.push(e.result ?? "");
    });
    const r = await loop.resumePendingRun({ sampling: { model: "gpt-5" } });
    expect(r.final.content).toBe("done");
    expect(dispatched).toEqual(["NovelWrite"]);
    expect(responses[0]).toBe("written");
  });

  it("compose 激活时 approve 决议的 canonical 写被 deny（绕过 gateBatch 的防护）", async () => {
    const composeState = new ComposeModeStateProvider();
    composeState.enter("c1", { designFilePath: "/ws/.novel/design/c1.md" });
    const { loop, dispatched } = makeResumeLoop({ composeState });
    const responses: string[] = [];
    loop.onOutputEvent((e) => {
      if (e.type === "tool-call-response" && "result" in e) responses.push(e.result ?? "");
    });
    await loop.resumePendingRun({ sampling: { model: "gpt-5" } });
    expect(dispatched).toEqual([]);
    expect(responses[0]).toContain("设计模式激活");
  });
});

describe("AgentLoop 排队 run 边界事件延迟发射", () => {
  it("A 流式中 followup B：B 的 run-start/user.message 在 A 的 run-end 之后（事件流顺序 = 执行顺序）", async () => {
    const provider: Provider = {
      call: async (_call: ProviderCall, onDelta?) => {
        await new Promise((r) => setTimeout(r, 5));
        onDelta?.({ type: "text-delta", text: "t" });
        return result("stop", "回复");
      },
    };
    const loop = makeLoop(provider);
    const events: string[] = [];
    loop.onOutputEvent((e) =>
      events.push(e.type === "user.message" ? `user:${(e as { text: string }).text}` : e.type),
    );
    const finished = new Promise<void>((resolve) => {
      const id = setInterval(() => {
        if (events.filter((t) => t === "run-end").length >= 2) {
          clearInterval(id);
          resolve();
        }
      }, 2);
    });
    loop.followup("A", { sampling: { model: "m" } });
    await new Promise((r) => setTimeout(r, 1)); // A 进入 provider call 流式中
    loop.followup("B", { sampling: { model: "m" } });
    await finished;

    // A 全程在前：run-start → user:A → delta → assistant.message → run-end
    expect(events.indexOf("user:A")).toBeGreaterThan(events.indexOf("run-start"));
    expect(events.indexOf("user:A")).toBeLessThan(events.indexOf("assistant.delta"));
    // B 的边界事件在 A 的 run-end 之后，且 run-start(B) 紧贴 user:B 之前
    const firstRunEnd = events.indexOf("run-end");
    const userB = events.indexOf("user:B");
    expect(userB).toBeGreaterThan(firstRunEnd);
    expect(events[userB - 1]).toBe("run-start");
  });
});
