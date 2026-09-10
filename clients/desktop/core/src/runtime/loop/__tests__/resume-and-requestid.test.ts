import { describe, it, expect } from "vitest";
import { findPendingToolIds } from "../AgentLoop.js";
import type { LLMessage } from "../../provider/types.js";
import { readPersistedMode, persistMode } from "../../../node/runtime/runDesktopRuntimeChildEntrypoint.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("审批批次恢复映射（toolCalls 成员 → 批决策）", () => {
  it("批次条目的每个 toolCallId 都映射到同一条目（整批共享决策）", () => {
    // 模拟 child 入口的 byToolCallId 构建（审批按 turn 批量：
    // 一条 ApprovalQueueItem 展开出 M 个成员映射）
    const decisions = [
      {
        requestId: "approval:conv_5:3:b1",
        toolCalls: [
          { toolCallId: "call_abc_123", toolName: "NovelWrite", args: "{}" },
          { toolCallId: "call_def_456", toolName: "OutlineWrite", args: "{}" },
        ],
        status: "approved",
      },
    ];
    const byToolCallId = new Map<string, { status: string }>();
    for (const item of decisions) {
      for (const tc of item.toolCalls) byToolCallId.set(tc.toolCallId, item);
    }
    expect(byToolCallId.get("call_abc_123")?.status).toBe("approved");
    expect(byToolCallId.get("call_def_456")?.status).toBe("approved");
  });
});

describe("会话模式持久化（meta.json 合并读写）", () => {
  it("persistMode 保留已有 name 字段，readPersistedMode 还原", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-mode-"));
    try {
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ name: "第一章" }), "utf8");
      persistMode(dir, "bypass");
      expect(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))).toEqual({
        name: "第一章",
        mode: "bypass",
      });
      expect(readPersistedMode(dir)).toBe("bypass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("无文件/损坏/非法值回退 undefined（默认 review）", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-mode-"));
    try {
      expect(readPersistedMode(dir)).toBeUndefined();
      expect(readPersistedMode(undefined)).toBeUndefined();
      writeFileSync(join(dir, "meta.json"), "{broken", "utf8");
      expect(readPersistedMode(dir)).toBeUndefined();
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ mode: "yolo" }), "utf8");
      expect(readPersistedMode(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
