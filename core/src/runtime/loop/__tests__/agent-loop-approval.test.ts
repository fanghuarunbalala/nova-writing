/**
 * AgentLoop 审批门控测试（按 turn 批量）：一次模型返回的多个待审调用合并为
 * 一次征询、决策作用于整批；批准放行、拒绝文本进 turn、未装配按拒绝、读工具不审。
 */
import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../AgentLoop.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import type { Provider, ProviderCall, ProviderResult } from "../../provider/types.js";
import type { ConversationApprovalRequest } from "../../../conversation/contract/types/index.js";

/** tool_call 结果（一次返回多个工具调用） */
function toolCallResult(calls: Array<{ toolName: string; id: string }>): ProviderResult {
  return {
    finishReason: "tool_call",
    message: {
      role: "assistant",
      content: "",
      toolCalls: calls.map((c) => ({ id: c.id, name: c.toolName, args: "{}" })),
    },
  };
}

function stopResult(content: string): ProviderResult {
  return { finishReason: "stop", message: { role: "assistant", content } };
}

/** 假写工具（requireApproval 可选） */
function writeTool(name: string, requireApproval: boolean): ToolDef {
  return {
    name,
    version: "1.0.0",
    requireApproval,
    handler: { execute: async () => "written" },
  };
}

/** 构造 loop：provider 依次回 results 再回 stop */
function makeLoop(
  results: ProviderResult[],
  opts: {
    toolDefs: ToolDef[];
    requestApproval?: (req: ConversationApprovalRequest) => Promise<{ kind: "approve" | "reject" | "edit"; text?: string }>;
  },
): AgentLoop {
  const provider: Provider = {
    call: async (_call: ProviderCall, onDelta?: (d: { type: "text-delta"; text: string }) => void) => {
      onDelta?.({ type: "text-delta", text: "x" });
      return results.shift() ?? stopResult("done");
    },
  };
  const capability: AgentCapability = {
    systemSections: [],
    toolDefs: opts.toolDefs,
    nudgePolicies: [],
    compactPolicies: [],
  };
  return new AgentLoop({
    workspace: "/ws",
    provider,
    agentCapability: capability,
    toolDispatcher: {
      dispatch: async (_ctx, call) => `result:${call.name}`,
      resolve: (name) => opts.toolDefs.find((t) => t.name === name),
    },
    conversationId: "c1",
    ...(opts.requestApproval !== undefined ? { requestApproval: opts.requestApproval as never } : {}),
  });
}

describe("AgentLoop 审批门控（按 turn 批量）", () => {
  it("批准 → handler 执行、turn 正常收口", async () => {
    const requestApproval = vi.fn().mockResolvedValue({ kind: "approve" });
    const loop = makeLoop([toolCallResult([{ toolName: "NovelWrite", id: "t1" }]), stopResult("完成")], {
      toolDefs: [writeTool("NovelWrite", true)],
      requestApproval,
    });
    const events: string[] = [];
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => events.push(e.type));
    expect(r.final.content).toBe("完成");
    expect(requestApproval).toHaveBeenCalledOnce();
    const req = requestApproval.mock.calls[0]![0]!;
    expect(req.toolCalls).toHaveLength(1);
    expect(req.toolCalls[0]!.toolName).toBe("NovelWrite");
    expect(req.requestId).toContain("approval:c1:");
    expect(events).toContain("tool-call-request");
    expect(events).toContain("tool-call-response");
  });

  it("混合批次：2 待审 + 1 免审 → 一次征询含 2 项、免审项不进批次直接执行", async () => {
    const requestApproval = vi.fn().mockResolvedValue({ kind: "approve" });
    const loop = makeLoop(
      [
        toolCallResult([
          { toolName: "NovelWrite", id: "t1" },
          { toolName: "OutlineWrite", id: "t2" },
          { toolName: "CharacterRead", id: "t3" },
        ]),
        stopResult("done"),
      ],
      {
        toolDefs: [writeTool("NovelWrite", true), writeTool("OutlineWrite", true), writeTool("CharacterRead", false)],
        requestApproval,
      },
    );
    const responses: string[] = [];
    await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => {
      if (e.type === "tool-call-response" && "result" in e) responses.push(e.result ?? "");
    });
    expect(requestApproval).toHaveBeenCalledOnce();
    const req = requestApproval.mock.calls[0]![0]!;
    expect(req.toolCalls.map((tc) => tc.toolCallId)).toEqual(["t1", "t2"]);
    // 三个工具都执行了（免审项未被拦截）
    expect(responses).toEqual(["result:NovelWrite", "result:OutlineWrite", "result:CharacterRead"]);
  });

  it("同 turn 多轮工具批次 → requestId 唯一（第二次征询不被队列幂等吞掉）", async () => {
    const requestApproval = vi.fn().mockResolvedValue({ kind: "approve" });
    const loop = makeLoop(
      [
        toolCallResult([{ toolName: "NovelWrite", id: "t1" }]),
        toolCallResult([{ toolName: "NovelWrite", id: "t2" }]),
        stopResult("done"),
      ],
      { toolDefs: [writeTool("NovelWrite", true)], requestApproval },
    );
    await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(requestApproval).toHaveBeenCalledTimes(2);
    const ids = requestApproval.mock.calls.map((c) => c[0]!.requestId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/:b1$/);
    expect(ids[1]).toMatch(/:b2$/);
  });

  it("拒绝 → handler 未调用、批内全部 tool 结果为「已拒绝」、turn 继续", async () => {
    const execute = vi.fn().mockResolvedValue("written");
    const tool: ToolDef = { ...writeTool("NovelWrite", true), handler: { execute } };
    const loop = makeLoop([toolCallResult([{ toolName: "NovelWrite", id: "t1" }]), stopResult("已收到拒绝")], {
      toolDefs: [tool],
      requestApproval: vi.fn().mockResolvedValue({ kind: "reject" }),
    });
    const responses: string[] = [];
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => {
      if (e.type === "tool-call-response" && "result" in e) responses.push(e.result ?? "");
    });
    expect(execute).not.toHaveBeenCalled();
    expect(responses).toEqual(["已拒绝"]);
    expect(r.final.content).toBe("已收到拒绝");
  });

  it("edit 决策 → 批内全部按「已拒绝（用户意见：…）」收口", async () => {
    const loop = makeLoop(
      [toolCallResult([{ toolName: "NovelWrite", id: "t1" }, { toolName: "OutlineWrite", id: "t2" }]), stopResult("ok")],
      {
        toolDefs: [writeTool("NovelWrite", true), writeTool("OutlineWrite", true)],
        requestApproval: vi.fn().mockResolvedValue({ kind: "edit", text: "语气再轻松点" }),
      },
    );
    const responses: string[] = [];
    await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => {
      if (e.type === "tool-call-response" && "result" in e) responses.push(e.result ?? "");
    });
    expect(responses).toEqual(["已拒绝（用户意见：语气再轻松点）", "已拒绝（用户意见：语气再轻松点）"]);
  });

  it("未注入 requestApproval → 按拒绝回退（「已拒绝（审批通道未装配）」）、turn 继续", async () => {
    const execute = vi.fn().mockResolvedValue("written");
    const tool: ToolDef = { ...writeTool("NovelWrite", true), handler: { execute } };
    const loop = makeLoop([toolCallResult([{ toolName: "NovelWrite", id: "t1" }]), stopResult("ok")], {
      toolDefs: [tool],
    });
    const responses: string[] = [];
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => {
      if (e.type === "tool-call-response" && "result" in e) responses.push(e.result ?? "");
    });
    expect(execute).not.toHaveBeenCalled();
    expect(responses).toEqual(["已拒绝（审批通道未装配）"]);
    expect(r.final.content).toBe("ok");
  });

  it("读工具（无 requireApproval）→ 直接 dispatch、requestApproval 从未调用", async () => {
    const requestApproval = vi.fn();
    const loop = makeLoop([toolCallResult([{ toolName: "CharacterRead", id: "t1" }]), stopResult("done")], {
      toolDefs: [writeTool("CharacterRead", false)],
      requestApproval,
    });
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(r.final.content).toBe("done");
    expect(requestApproval).not.toHaveBeenCalled();
  });
});
