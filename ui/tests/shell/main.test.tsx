/**
 * main 区组件测试：MainSubHead / chatSurfaceMapper。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainSubHead } from "../../src/shell/main/MainSubHead.js";
import { mapProjectionTimeline } from "../../src/shell/main/chatSurfaceMapper.js";
import type { ConversationProjectionSnapshot } from "@novel/core";

function projection(overrides: Partial<ConversationProjectionSnapshot>): ConversationProjectionSnapshot {
  return {
    conversationId: "c1",
    revision: 1,
    lastAppliedSequence: 3,
    events: [],
    toolTraces: [],
    timeline: [],
    userMessages: [],
    assistantMessages: [],
    approvals: [],
    runs: [],
    turns: [],
    ...overrides,
  };
}

describe("MainSubHead", () => {
  it("renders title/sub and back action", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<MainSubHead title="对话" sub="Novel Agent" onBack={onBack} />);
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.getByText("Novel Agent")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("chatSurfaceMapper", () => {
  it("maps user, assistant and approval items", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "user-message",
            eventId: "e1",
            sequence: 1,
            timestamp: "2026-08-05T09:00:00.000Z",
            text: "改雨景",
          },
          {
            kind: "assistant-message",
            assistantMessageId: "a1",
            runId: "r1",
            turnId: "t1",
            startedSequence: 2,
            lastSequence: 2,
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "completed",
            content: [
              { type: "thinking", thinking: "把'雨很大'改为'雨落得密'" },
              { type: "text", text: "已改为：雨落得密。" },
            ],
          },
        ],
      }),
      [],
      "Novel Agent",
    );
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("turn");
    expect(items[1].kind).toBe("user");
    if (items[2].kind === "assistant") {
      expect(items[2].thinkLines).toHaveLength(1);
      expect(items[2].text).toBe("已改为：雨落得密。");
      expect(items[2].approvalState).toBe("completed");
    }
  });

  it("inserts turn separators and attaches event flow and tool traces", () => {
    const items = mapProjectionTimeline(
      projection({
        events: [
          {
            eventId: "e-input",
            sequence: 1,
            direction: "input",
            eventType: "user.message",
            timestamp: "2026-08-05T09:00:00.000Z",
            recordedAt: "2026-08-05T09:00:00.000Z",
          },
          {
            eventId: "e-run",
            sequence: 2,
            direction: "output",
            eventType: "agent.run.state.changed",
            summary: "— → running · provider_started",
            timestamp: "2026-08-05T09:00:01.000Z",
            recordedAt: "2026-08-05T09:00:01.000Z",
          },
          {
            eventId: "e-draft",
            sequence: 3,
            direction: "output",
            eventType: "novel.draft.started",
            summary: "草稿会话 DS-1 启动 · base r041",
            timestamp: "2026-08-05T09:00:02.000Z",
            recordedAt: "2026-08-05T09:00:02.000Z",
          },
          {
            eventId: "e-delta",
            sequence: 4,
            direction: "output",
            eventType: "agent.assistant.message.delta",
            summary: "增量更新",
            timestamp: "2026-08-05T09:00:03.000Z",
            recordedAt: "2026-08-05T09:00:03.000Z",
          },
          {
            eventId: "e-trace-intermediate",
            sequence: 5,
            direction: "output",
            eventType: "system.tool.trace.recorded",
            summary: "工具 CharacterList · sandbox_started",
            timestamp: "2026-08-05T09:00:04.000Z",
            recordedAt: "2026-08-05T09:00:04.000Z",
          },
        ],
        toolTraces: [
          {
            traceId: "trace-1",
            toolName: "CharacterList",
            outcome: "ok",
            durationMs: 42,
            runId: "r1",
            sequence: 3,
            timestamp: "2026-08-05T09:00:02.000Z",
          },
          {
            traceId: "trace-2",
            toolName: "NovelOutlineRead",
            stage: "execution_failed",
            outcome: "failed",
            durationMs: 1500,
            runId: "r1",
            sequence: 5,
            timestamp: "2026-08-05T09:00:04.000Z",
          },
        ],
        timeline: [
          {
            kind: "user-message",
            eventId: "e-input",
            sequence: 1,
            timestamp: "2026-08-05T09:00:00.000Z",
            text: "继续",
          },
          {
            kind: "assistant-message",
            assistantMessageId: "a1",
            runId: "r1",
            turnId: "t1",
            startedSequence: 2,
            lastSequence: 6,
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "completed",
            content: [{ type: "text", text: "好。" }],
          },
        ],
      }),
      [],
      "Novel Agent",
    );
    expect(items[0].kind).toBe("turn");
    if (items[0].kind === "turn") {
      expect(items[0].label).toContain("第 1 轮");
    }
    const assistant = items.find((item) => item.kind === "assistant");
    if (assistant !== undefined && assistant.kind === "assistant") {
      // delta 与中间 trace 阶段不进事件流；只保留普通事件与终态 trace。
      expect(assistant.eventFlow).toHaveLength(3);
      expect(assistant.eventFlow[0].family).toBe("agent");
      expect(assistant.eventFlow[1].summary).toContain("草稿会话");
      expect(assistant.eventFlow[2].eventType).toBe("system.tool.trace.recorded");
      expect(assistant.eventFlow[2].outcome).toBe("failed");
      expect(assistant.eventFlow.some((event) => event.eventType === "agent.assistant.message.delta")).toBe(false);
      expect(assistant.eventFlow.some((event) => event.summary?.includes("sandbox_started"))).toBe(false);
      expect(assistant.toolTraces).toHaveLength(2);
      expect(assistant.toolTraces[0].toolName).toBe("CharacterList");
    }
  });

  it("attaches approval cards to the owning assistant message by sequence", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "assistant-message",
            assistantMessageId: "a1",
            runId: "r1",
            turnId: "t1",
            startedSequence: 2,
            lastSequence: 4,
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "completed",
            content: [{ type: "text", text: "已起草场景。" }],
          },
        ],
      }),
      [
        {
          cardId: "AR-1",
          kind: "approval",
          title: "变更提议",
          summary: "base r041 → 待提交 · 2 个操作",
          status: "pending",
          conversationId: "c1",
          sourceEventId: "e9",
          sourceSequence: 3,
          timestamp: "2026-08-05T09:00:02.000Z",
        },
        {
          cardId: "AR-2",
          kind: "approval",
          title: "变更提议",
          status: "pending",
          conversationId: "c1",
          sourceEventId: "e10",
          sourceSequence: 9,
          timestamp: "2026-08-05T09:00:03.000Z",
        },
      ],
      "Novel Agent",
    );
    expect(items).toHaveLength(1);
    if (items[0].kind === "assistant") {
      expect(items[0].cards).toHaveLength(1);
      if (items[0].cards[0].kind === "proposal") {
        expect(items[0].cards[0].content.changeSetId).toBe("AR-1");
        expect(items[0].cards[0].content.tag).toBe("proposal");
        expect(items[0].cards[0].content.meta).toContain("2 个操作");
      }
    }
  });
});
