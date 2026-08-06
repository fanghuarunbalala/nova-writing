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
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("user");
    if (items[1].kind === "assistant") {
      expect(items[1].thinkLines).toHaveLength(1);
      expect(items[1].text).toBe("已改为：雨落得密。");
      expect(items[1].approvalState).toBe("completed");
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
