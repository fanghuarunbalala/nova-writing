/**
 * AgentLoop 审批门控测试：requireApproval 工具经 requestApproval 征询；
 * 批准放行、拒绝文本进 turn、未装配按拒绝、读工具不审。
 */
import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../AgentLoop.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import type { Provider, ProviderCall, ProviderResult } from "../../provider/types.js";

/** tool_call 结果（调用一次写工具） */
function toolCallResult(toolName: string, id: string): ProviderResult {
  return {
    finishReason: "tool_call",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [{ id, name: toolName, args: "{}" }],
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

/** 构造 loop：provider 先回一次 tool_call 再回 stop */
function makeLoop(
  results: ProviderResult[],
  opts: {
    toolDefs: ToolDef[];
    requestApproval?: (req: { requestId: string; toolName: string; args: string }) => Promise<{ kind: "approve" | "reject" | "edit"; text?: string }>;
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
    },
    conversationId: "c1",
    ...(opts.requestApproval !== undefined ? { requestApproval: opts.requestApproval as never } : {}),
  });
}

describe("AgentLoop 审批门控", () => {
  it("批准 → handler 执行、turn 正常收口", async () => {
    const requestApproval = vi.fn().mockResolvedValue({ kind: "approve" });
    const loop = makeLoop([toolCallResult("NovelWrite", "t1"), stopResult("完成")], {
      toolDefs: [writeTool("NovelWrite", true)],
      requestApproval,
    });
    const events: string[] = [];
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } }, (e) => events.push(e.type));
    expect(r.final.content).toBe("完成");
    expect(requestApproval).toHaveBeenCalledOnce();
    const req = requestApproval.mock.calls[0]![0]!;
    expect(req.toolName).toBe("NovelWrite");
    expect(req.requestId).toContain("approval_c1_");
    expect(events).toContain("tool-call-request");
    expect(events).toContain("tool-call-response");
  });

  it("拒绝 → handler 未调用、tool 结果为「已拒绝」、turn 继续", async () => {
    const execute = vi.fn().mockResolvedValue("written");
    const tool: ToolDef = { ...writeTool("NovelWrite", true), handler: { execute } };
    const loop = makeLoop([toolCallResult("NovelWrite", "t1"), stopResult("已收到拒绝")], {
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

  it("未注入 requestApproval → 按拒绝回退（「已拒绝（审批通道未装配）」）、turn 继续", async () => {
    const execute = vi.fn().mockResolvedValue("written");
    const tool: ToolDef = { ...writeTool("NovelWrite", true), handler: { execute } };
    const loop = makeLoop([toolCallResult("NovelWrite", "t1"), stopResult("ok")], {
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
    const loop = makeLoop([toolCallResult("CharacterRead", "t1"), stopResult("done")], {
      toolDefs: [writeTool("CharacterRead", false)],
      requestApproval,
    });
    const r = await loop.run("hi", { sampling: { model: "gpt-5" } });
    expect(r.final.content).toBe("done");
    expect(requestApproval).not.toHaveBeenCalled();
  });
});
