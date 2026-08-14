import { describe, it, expect } from "vitest";
import { findPendingToolIds } from "../AgentLoop.js";
import type { LLMessage } from "../../provider/types.js";
import { toolCallIdOf } from "../../../node/runtime/runDesktopRuntimeChildEntrypoint.js";

describe("findPendingToolIds（resume 触发判定）", () => {
  it("已收口 turn（每个 toolCall 都有 tool 结果）返回空", () => {
    const messages: LLMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "Read", args: "{}" }] },
      { role: "tool", content: "ok", id: "t1" },
      { role: "assistant", content: "done" },
    ];
    expect(findPendingToolIds(messages)).toEqual([]);
  });

  it("缺 tool 结果的 toolCall 被检出", () => {
    const messages: LLMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "Read", args: "{}" }, { id: "t2", name: "Write", args: "{}" }] },
      { role: "tool", content: "ok", id: "t1" },
    ];
    expect(findPendingToolIds(messages)).toEqual(["t2"]);
  });

  it("无工具调用的消息返回空", () => {
    expect(findPendingToolIds([{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }])).toEqual([]);
  });
});

describe("审批 requestId 编解码往返（冒号分隔）", () => {
  it("conv id 含下划线 + toolCallId 含下划线均可还原", () => {
    // 生成端（AgentLoop.gateTool）格式：approval:{convId}:{turnSeq}:{toolCallId}
    const convId = "conv_5";
    const toolCallId = "call_abc_123";
    const requestId = `approval:${convId}:3:${toolCallId}`;
    expect(toolCallIdOf(requestId)).toBe(toolCallId);
  });

  it("未知格式返回 undefined", () => {
    expect(toolCallIdOf("approval_conv_1_1_t1")).toBeUndefined();
    expect(toolCallIdOf("short")).toBeUndefined();
  });
});
