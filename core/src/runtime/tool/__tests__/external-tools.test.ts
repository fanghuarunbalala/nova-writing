import { describe, it, expect } from "vitest";
import { DeferredToolRegistry } from "../deferred/DeferredToolRegistry.js";
import {
  createSearchExtraToolsTool,
  createExecuteExtraTool,
  createDeferredRejectionStub,
} from "../definitions/externalTools.js";
import type { ToolDef } from "../ToolDef.js";
import type { ConversationApprovalRequest } from "../../../conversation/contract/types/index.js";

/** 目标延迟工具夹具：记录内嵌调用（name/args） */
function makeTarget(name: string, requireApproval = false): { def: ToolDef; calls: { name: string; args: string }[] } {
  const calls: { name: string; args: string }[] = [];
  const def: ToolDef = {
    name,
    version: "1.0.0",
    description: `desc:${name}`,
    parameters: { type: "object", properties: { a: { type: "string" } } },
    ...(requireApproval ? { requireApproval: true } : {}),
    handler: {
      execute: async (call) => {
        calls.push({ name: call.name, args: call.args });
        return `ok:${call.name}`;
      },
    },
  };
  return { def, calls };
}

function makeCall(name: string, args: unknown, id = "tc-1") {
  return { id, name, args: JSON.stringify(args) };
}

describe("SearchExtraTools", () => {
  it("查询结果文本直出（select:）", async () => {
    const { def } = makeTarget("mcp__slack__send");
    const tool = createSearchExtraToolsTool(new DeferredToolRegistry([def]));
    const result = await tool.handler.execute(makeCall("SearchExtraTools", { query: "select:mcp__slack__send" }));
    expect(result).toContain("找到 1 个延迟工具");
    expect(result).toContain("mcp__slack__send");
  });

  it("discover: 返回参数 schema", async () => {
    const { def } = makeTarget("mcp__slack__send");
    const tool = createSearchExtraToolsTool(new DeferredToolRegistry([def]));
    const result = await tool.handler.execute(makeCall("SearchExtraTools", { query: "discover:slack" }));
    expect(result).toContain("参数 schema:");
    expect(result).toContain("mcp__slack__send");
  });

  it("query 缺失 → TOOL_ARGUMENTS_INVALID", async () => {
    const tool = createSearchExtraToolsTool(new DeferredToolRegistry());
    await expect(tool.handler.execute(makeCall("SearchExtraTools", {}))).rejects.toThrow(/query/);
  });

  it("max_results 非数字 → TOOL_ARGUMENTS_INVALID", async () => {
    const tool = createSearchExtraToolsTool(new DeferredToolRegistry());
    await expect(
      tool.handler.execute(makeCall("SearchExtraTools", { query: "x", max_results: "5" })),
    ).rejects.toThrow(/max_results/);
  });
});

describe("ExecuteExtraTool", () => {
  it("受信目标：免审批直执行，内嵌调用携带真实工具名与参数 JSON", async () => {
    const { def, calls } = makeTarget("mcp__slack__send");
    const approvals: ConversationApprovalRequest[] = [];
    const tool = createExecuteExtraTool(new DeferredToolRegistry([def]), {
      conversationId: "conv-1",
      requestApproval: async (req) => {
        approvals.push(req);
        return { kind: "approve" };
      },
    });
    const result = await tool.handler.execute(
      makeCall("ExecuteExtraTool", { tool_name: "mcp__slack__send", params: { a: "hi" } }),
    );
    expect(result).toBe("ok:mcp__slack__send");
    expect(calls).toEqual([{ name: "mcp__slack__send", args: JSON.stringify({ a: "hi" }) }]);
    expect(approvals).toHaveLength(0); // 受信不征询
  });

  it("非受信目标：approve 后执行，审批请求带真实工具名与 requestId 归组", async () => {
    const { def, calls } = makeTarget("mcp__slack__send", true);
    const requests: ConversationApprovalRequest[] = [];
    const tool = createExecuteExtraTool(new DeferredToolRegistry([def]), {
      conversationId: "conv-9",
      requestApproval: async (req) => {
        requests.push(req);
        return { kind: "approve" };
      },
    });
    const result = await tool.handler.execute(
      makeCall("ExecuteExtraTool", { tool_name: "mcp__slack__send", params: { a: "hi" } }, "tc-77"),
    );
    expect(result).toBe("ok:mcp__slack__send");
    expect(calls).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.requestId).toBe("approval:conv-9:deferred:tc-77");
    expect(requests[0]!.toolCalls).toEqual([
      { toolCallId: "tc-77", toolName: "mcp__slack__send", args: JSON.stringify({ a: "hi" }) },
    ]);
  });

  it("非受信目标：reject 返回「已拒绝」且不执行", async () => {
    const { def, calls } = makeTarget("mcp__slack__send", true);
    const tool = createExecuteExtraTool(new DeferredToolRegistry([def]), {
      requestApproval: async () => ({ kind: "reject" }),
    });
    const result = await tool.handler.execute(
      makeCall("ExecuteExtraTool", { tool_name: "mcp__slack__send", params: { a: "hi" } }),
    );
    expect(result).toBe("已拒绝");
    expect(calls).toHaveLength(0);
  });

  it("非受信目标：edit 返回「已拒绝（用户意见）」", async () => {
    const { def, calls } = makeTarget("mcp__slack__send", true);
    const tool = createExecuteExtraTool(new DeferredToolRegistry([def]), {
      requestApproval: async () => ({ kind: "edit", text: "不要发" }),
    });
    const result = await tool.handler.execute(
      makeCall("ExecuteExtraTool", { tool_name: "mcp__slack__send", params: { a: "hi" } }),
    );
    expect(result).toBe("已拒绝（用户意见：不要发）");
    expect(calls).toHaveLength(0);
  });

  it("非受信目标：审批通道未装配 → 返回「已拒绝（审批通道未装配）」且不执行", async () => {
    const { def, calls } = makeTarget("mcp__slack__send", true);
    const tool = createExecuteExtraTool(new DeferredToolRegistry([def]));
    const result = await tool.handler.execute(
      makeCall("ExecuteExtraTool", { tool_name: "mcp__slack__send", params: { a: "hi" } }),
    );
    expect(result).toBe("已拒绝（审批通道未装配）");
    expect(calls).toHaveLength(0);
  });

  it("未找到目标 → TOOL_NOT_AVAILABLE 附搜索引导", async () => {
    const tool = createExecuteExtraTool(new DeferredToolRegistry());
    await expect(
      tool.handler.execute(makeCall("ExecuteExtraTool", { tool_name: "mcp__nope__x", params: {} })),
    ).rejects.toThrow(/未找到延迟工具: mcp__nope__x/);
  });

  it("tool_name 缺失 / params 非对象 → TOOL_ARGUMENTS_INVALID", async () => {
    const tool = createExecuteExtraTool(new DeferredToolRegistry());
    await expect(tool.handler.execute(makeCall("ExecuteExtraTool", { params: {} }))).rejects.toThrow(/tool_name/);
    await expect(
      tool.handler.execute(makeCall("ExecuteExtraTool", { tool_name: "x", params: [1, 2] })),
    ).rejects.toThrow(/params/);
    await expect(
      tool.handler.execute(makeCall("ExecuteExtraTool", { tool_name: "x", params: "str" })),
    ).rejects.toThrow(/params/);
  });
});

describe("createDeferredRejectionStub", () => {
  it("直接调用抛错引导两步流程；无 requireApproval", async () => {
    const { def } = makeTarget("mcp__slack__send", true);
    const stub = createDeferredRejectionStub(def);
    expect(stub.name).toBe("mcp__slack__send");
    expect(stub.requireApproval).toBeUndefined();
    await expect(stub.handler.execute(makeCall("mcp__slack__send", {}))).rejects.toThrow(
      /请先调用 SearchExtraTools 发现/,
    );
  });
});
