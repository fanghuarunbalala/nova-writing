/**
 * main 区组件测试：MainSubHead / chatSurfaceMapper。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainSubHead } from "../../src/shell/main/MainSubHead.js";
import {
  composeStatusLabel,
  mapProjectionTimeline,
} from "../../src/shell/main/chatSurfaceMapper.js";
import type { ConversationProjectionSnapshot } from "@novel/core";
import type { ConversationTimelineItem } from "../../src/domains/conversation/projection/ConversationTimelineItem.js";

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

  it("maps novel.compose events to design items", () => {
    const items = mapProjectionTimeline(
      projection({
        events: [
          {
            eventId: "compose-1",
            sequence: 1,
            direction: "output",
            eventType: "novel.compose.begin",
            timestamp: "2026-08-07T00:00:00.000Z",
            recordedAt: "2026-08-07T00:00:00.000Z",
          },
          {
            eventId: "compose-2",
            sequence: 2,
            direction: "output",
            eventType: "novel.compose.submitted",
            timestamp: "2026-08-07T00:00:01.000Z",
            recordedAt: "2026-08-07T00:00:01.000Z",
          },
        ],
      }),
      [],
      "Novel Agent",
    );
    const designItems = items.filter(
      (
        item,
      ): item is Extract<ConversationTimelineItem, { readonly kind: "design" }> =>
        item.kind === "design",
    );
    expect(designItems).toHaveLength(2);
    expect(designItems[0].design.phase).toBe("designing");
    expect(designItems[1].design.phase).toBe("pending");
    expect(designItems[0].design.conversationId).toBe("c1");
  });

  it("computes the compose badge label from the projected compose phase", () => {
    expect(composeStatusLabel({ composePhase: "designing" })).toBe("设计中");
    expect(composeStatusLabel({ composePhase: "pending" })).toBe("待审批");
    expect(composeStatusLabel({ composePhase: undefined })).toBeUndefined();
    expect(composeStatusLabel({})).toBeUndefined();
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
          {
            traceId: "trace-3",
            toolName: "NovelVolumeRead",
            stage: "execution_failed",
            outcome: "failed",
            runId: "r1",
            sequence: 7,
            timestamp: "2026-08-05T09:00:05.000Z",
          },
        ],
        turns: [
          {
            runId: "r1",
            turnId: "t1",
            previous: null,
            current: "running",
            reason: "provider_started",
            lastSequence: 8,
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
      // v2 原型：轮次分隔只显示纯时间（HH:MM），去掉「第 N 轮 ·」前缀；
      // 本地时区不固定，故只断言格式与无前缀。
      expect(items[0].label).toMatch(/^\d{2}:\d{2}$/);
      expect(items[0].label).not.toContain("第");
    }
    const assistant = items.find((item) => item.kind === "assistant");
    if (assistant !== undefined && assistant.kind === "assistant") {
      // delta 与中间 trace 阶段不进事件流；只保留普通事件与终态 trace；
      // 消息 completed 之后、turn 结束之前（gap）的失败 trace 也归属到本轮。
      expect(assistant.eventFlow).toHaveLength(4);
      expect(assistant.eventFlow[0].family).toBe("agent");
      expect(assistant.eventFlow[1].summary).toContain("草稿会话");
      expect(assistant.eventFlow[2].eventType).toBe("system.tool.trace.recorded");
      expect(assistant.eventFlow[2].outcome).toBe("failed");
      expect(assistant.eventFlow[3].outcome).toBe("failed");
      expect(assistant.eventFlow.some((event) => event.eventType === "agent.assistant.message.delta")).toBe(false);
      expect(assistant.eventFlow.some((event) => event.summary?.includes("sandbox_started"))).toBe(false);
      expect(assistant.toolTraces).toHaveLength(3);
      expect(assistant.toolTraces[0].toolName).toBe("CharacterList");
    }
  });

  it("maps tool-approval timeline items into approval cards", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "tool-approval",
            approvalRequestId: "AR-1",
            toolCallId: "call-1",
            toolName: "NovelOutlineWrite",
            toolVersion: "1.0.0",
            argumentDigest: `sha256:${"0".repeat(64)}`,
            runId: "r1",
            requestedSequence: 3,
            lastSequence: 3,
            title: "新增大纲单元",
            description: "目标：第一章 序章",
            operations: [
              { op: "add", kind: "outline", id: "s1", title: "第一章 序章" },
            ],
            arguments: {
              values: [{ id: "s1", title: "第一章 序章", intent: "引入主角" }],
            },
            requestedAt: "2026-08-05T09:00:02.000Z",
            expiresAt: "2026-08-05T09:15:02.000Z",
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "pending",
          },
        ],
      }),
      [],
      "Novel Agent",
    );
    expect(items).toHaveLength(1);
    if (items[0].kind === "approval") {
      expect(items[0].approval.approvalRequestIds).toEqual(["AR-1"]);
      expect(items[0].approval.title).toBe("新增大纲单元");
      expect(items[0].approval.operations).toEqual([
        {
          op: "add",
          kind: "outline",
          id: "s1",
          title: "第一章 序章",
          toolName: "NovelOutlineWrite",
        },
      ]);
      expect(items[0].approval.argumentGroups).toEqual([
        {
          toolName: "NovelOutlineWrite",
          arguments: {
            values: [{ id: "s1", title: "第一章 序章", intent: "引入主角" }],
          },
        },
      ]);
    }
  });

  it("maps generic cards into rich conversation card descriptors", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "user-message",
            eventId: "e1",
            sequence: 1,
            timestamp: "2026-08-05T09:00:00.000Z",
            text: "把雨景改成夜景",
          },
          {
            kind: "assistant-message",
            assistantMessageId: "a1",
            runId: "r1",
            turnId: "t1",
            startedSequence: 2,
            lastSequence: 8,
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "completed",
            content: [{ type: "text", text: "已按大纲调整。" }],
          },
        ],
      }),
      [
        {
          cardId: "CARD-REF",
          kind: "novel-reference",
          title: "§2 雨景",
          summary: "雨落得密",
          status: "informational",
          conversationId: "c1",
          sourceEventId: "e-ref",
          sourceSequence: 3,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "CARD-OUTLINE",
          kind: "outline-proposal",
          title: "新增 第一章 序章",
          summary: "拟新增一个故事单元",
          status: "pending",
          conversationId: "c1",
          sourceEventId: "e-outline",
          sourceSequence: 4,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "CARD-MANUSCRIPT",
          kind: "manuscript-proposal",
          title: "改写 第一节 夜景",
          status: "in-progress",
          conversationId: "c1",
          sourceEventId: "e-manuscript",
          sourceSequence: 5,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "CARD-CHAR",
          kind: "character-proposal",
          title: "角色 林晓 定稿",
          status: "accepted",
          conversationId: "c1",
          sourceEventId: "e-char",
          sourceSequence: 6,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "CARD-PUB",
          kind: "publication",
          title: "发布 v0.4",
          summary: "正式发布版本 v0.4",
          status: "completed",
          conversationId: "c1",
          sourceEventId: "e-pub",
          sourceSequence: 8,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
      ],
      "Novel Agent",
    );
    const assistant = items.find((item) => item.kind === "assistant");
    expect(assistant).toBeDefined();
    if (assistant === undefined || assistant.kind !== "assistant") return;
    expect(assistant.cards).toHaveLength(5);
    // novel-reference → quote，attribution 取 title（summary ≠ title 时）
    expect(assistant.cards[0]).toEqual({
      kind: "quote",
      id: "CARD-REF",
      content: {
        text: { kind: "text", text: "雨落得密" },
        attribution: "§2 雨景",
      },
    });
    // outline-proposal pending → proposal tag=proposal，meta 取 summary
    expect(assistant.cards[1]).toEqual({
      kind: "proposal",
      id: "CARD-OUTLINE",
      content: {
        tag: "proposal",
        title: "新增 第一章 序章",
        meta: "拟新增一个故事单元",
        ops: [],
      },
    });
    // manuscript-proposal in-progress → proposal tag=plan
    expect(assistant.cards[2]).toEqual({
      kind: "proposal",
      id: "CARD-MANUSCRIPT",
      content: {
        tag: "plan",
        title: "改写 第一节 夜景",
        meta: undefined,
        ops: [],
      },
    });
    // character-proposal accepted → proposal tag=applied
    expect(assistant.cards[3]).toEqual({
      kind: "proposal",
      id: "CARD-CHAR",
      content: {
        tag: "applied",
        title: "角色 林晓 定稿",
        ops: [],
      },
    });
    // publication → text，richText 取 summary
    expect(assistant.cards[4]).toEqual({
      kind: "text",
      id: "CARD-PUB",
      content: {
        richText: { kind: "text", text: "正式发布版本 v0.4" },
      },
    });
  });

  it("maps cards only when they fall inside the assistant message's sequence window", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "user-message",
            eventId: "e1",
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
            lastSequence: 5,
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "completed",
            content: [{ type: "text", text: "好。" }],
          },
        ],
      }),
      [
        {
          cardId: "CARD-IN",
          kind: "approval",
          title: "同意提交正文草稿",
          status: "pending",
          conversationId: "c1",
          sourceEventId: "e-in",
          sourceSequence: 3,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "CARD-OUT-BEFORE",
          kind: "task",
          title: "早于本轮",
          status: "completed",
          conversationId: "c1",
          sourceEventId: "e-out-before",
          sourceSequence: 1,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "CARD-OUT-AFTER",
          kind: "location-proposal",
          title: "晚于本轮",
          status: "rejected",
          conversationId: "c1",
          sourceEventId: "e-out-after",
          sourceSequence: 9,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
      ],
      "Novel Agent",
    );
    const assistant = items.find((item) => item.kind === "assistant");
    expect(assistant).toBeDefined();
    if (assistant === undefined || assistant.kind !== "assistant") return;
    expect(assistant.cards).toHaveLength(1);
    expect(assistant.cards[0]).toMatchObject({ id: "CARD-IN" });
  });

  it("maps proposal statuses onto tags and omits meta when summary is absent", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "assistant-message",
            assistantMessageId: "a1",
            runId: "r1",
            turnId: "t1",
            startedSequence: 1,
            lastSequence: 10,
            timestamp: "2026-08-05T09:00:01.000Z",
            status: "completed",
            content: [{ type: "text", text: "已处理。" }],
          },
        ],
      }),
      [
        {
          cardId: "C-TASK",
          kind: "task",
          title: "回填角色关系",
          status: "in-progress",
          conversationId: "c1",
          sourceEventId: "e1",
          sourceSequence: 2,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "C-FAIL",
          kind: "approval",
          title: "提交失败",
          status: "failed",
          conversationId: "c1",
          sourceEventId: "e2",
          sourceSequence: 3,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
        {
          cardId: "C-STALE",
          kind: "location-proposal",
          title: "过期方案",
          status: "stale",
          conversationId: "c1",
          sourceEventId: "e3",
          sourceSequence: 4,
          timestamp: "2026-08-05T09:00:01.000Z",
        },
      ],
      "Novel Agent",
    );
    const assistant = items.find((item) => item.kind === "assistant");
    expect(assistant).toBeDefined();
    if (assistant === undefined || assistant.kind !== "assistant") return;
    // in-progress → plan；failed → proposal；stale → proposal
    const proposalTags = assistant.cards.map((card) =>
      card.kind === "proposal" ? card.content.tag : null,
    );
    expect(proposalTags).toEqual(["plan", "proposal", "proposal"]);
    // 无 summary 时不带 meta 字段
    expect(assistant.cards[0]).toMatchObject({ content: { tag: "plan", title: "回填角色关系" } });
    expect("meta" in (assistant.cards[0] as { content: { meta?: string } }).content).toBe(false);
  });

  it("groups tool approvals of the same turn into one card", () => {
    const digest = `sha256:${"0".repeat(64)}`;
    const base = {
      toolCallId: "call-1",
      toolName: "NovelOutlineWrite",
      toolVersion: "1.0.0",
      argumentDigest: digest,
      runId: "r1",
      turnId: "t1",
      lastSequence: 3,
      title: "新增大纲单元",
      description: "目标：第一章",
      operations: [{ op: "add", kind: "outline", id: "s1", title: "第一章" }],
      arguments: { values: [{ id: "s1", title: "第一章" }] },
      requestedAt: "2026-08-05T09:00:02.000Z",
      expiresAt: "2026-08-05T09:15:02.000Z",
      timestamp: "2026-08-05T09:00:01.000Z",
      status: "pending",
    };
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "tool-approval",
            approvalRequestId: "AR-1",
            requestedSequence: 3,
            ...base,
          },
          {
            kind: "tool-approval",
            approvalRequestId: "AR-2",
            requestedSequence: 4,
            ...base,
            toolName: "NovelCharacterWrite",
            operations: [
              { op: "add", kind: "character", id: "c1", title: "张三" },
            ],
            arguments: { values: [{ id: "c1", name: "张三" }] },
          },
        ],
      }),
      [],
      "Novel Agent",
    );
    expect(items).toHaveLength(1);
    if (items[0].kind === "approval") {
      expect(items[0].approval.approvalRequestIds).toEqual(["AR-1", "AR-2"]);
      expect(items[0].approval.toolNames).toEqual([
        "NovelOutlineWrite",
        "NovelCharacterWrite",
      ]);
      expect(items[0].approval.operations).toEqual([
        {
          op: "add",
          kind: "outline",
          id: "s1",
          title: "第一章",
          toolName: "NovelOutlineWrite",
        },
        {
          op: "add",
          kind: "character",
          id: "c1",
          title: "张三",
          toolName: "NovelCharacterWrite",
        },
      ]);
      expect(items[0].approval.argumentGroups).toHaveLength(2);
    }
  });
});
