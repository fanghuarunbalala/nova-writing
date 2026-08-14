/**
 * main 区组件测试：MainSubHead / chatSurfaceMapper。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainSubHead } from "../../src/shell/main/MainSubHead.js";
import { mapProjectionTimeline } from "../../src/shell/main/chatSurfaceMapper.js";
import type { ConversationProjectionSnapshot } from "@novel/core/client";

function projection(overrides: Partial<ConversationProjectionSnapshot>): ConversationProjectionSnapshot {
  return {
    conversationId: "c1",
    revision: 1,
    lastAppliedSequence: 0,
    state: "running",
    timeline: [],
    cards: [],
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
  it("maps user and assistant items with turn separators", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "user",
            sequence: 1,
            text: "改雨景",
            timestamp: "2026-08-05T09:00:00.000Z",
          },
          {
            kind: "assistant",
            sequence: 2,
            text: "已改为：雨落得密。",
            streaming: false,
            sourceSequence: 2,
            turnEndSequence: 2,
            timestamp: "2026-08-05T09:00:01.000Z",
          },
        ],
      }),
      "Novel Agent",
    );
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("turn");
    // v2 原型：轮次分隔只显示纯时间（HH:MM）；本地时区不固定，故只断言格式与无前缀。
    expect(items[0].label).toMatch(/^\d{2}:\d{2}$/);
    expect(items[0].label).not.toContain("第");
    expect(items[1].kind).toBe("user");
    if (items[1].kind === "user") {
      expect(items[1].text).toBe("改雨景");
    }
    const assistant = items[2];
    expect(assistant.kind).toBe("assistant");
    if (assistant.kind === "assistant") {
      expect(assistant.text).toBe("已改为：雨落得密。");
      expect(assistant.streaming).toBe(false);
      expect(assistant.approvalState).toBeUndefined();
      expect(assistant.cards).toHaveLength(0);
    }
  });

  it("marks streaming assistant items as generating", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          { kind: "assistant", sequence: 1, text: "雨", streaming: true },
        ],
      }),
      "Novel Agent",
    );
    expect(items).toHaveLength(1);
    if (items[0].kind === "assistant") {
      expect(items[0].streaming).toBe(true);
      expect(items[0].approvalState).toBeUndefined();
    }
  });

  it("passes assistant segments through verbatim（工具行随 turn 分段透传，无 seq 过滤）", () => {
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "user",
            sequence: 1,
            text: "继续",
            timestamp: "2026-08-05T09:00:00.000Z",
          },
          {
            kind: "assistant",
            sequence: 2,
            text: "好。",
            streaming: false,
            sourceSequence: 2,
            turnEndSequence: 7,
            segments: [
              {
                text: "好。",
                tools: [{ traceId: "trace-1", toolName: "CharacterList", outcome: "ok", durationMs: 42, sequence: 3 }],
              },
              {
                text: "",
                tools: [
                  { traceId: "trace-2", toolName: "NovelOutlineRead", outcome: "failed", durationMs: 1500, sequence: 5 },
                  { traceId: "trace-3", toolName: "NovelVolumeRead", outcome: "failed", sequence: 7 },
                ],
              },
            ],
            timestamp: "2026-08-05T09:00:01.000Z",
          },
        ],
      }),
      "Novel Agent",
    );
    const assistant = items.find((item) => item.kind === "assistant");
    expect(assistant).toBeDefined();
    if (assistant === undefined || assistant.kind !== "assistant") return;
    expect(assistant.segments).toHaveLength(2);
    expect(assistant.segments?.[0]).toMatchObject({ text: "好。" });
    expect(assistant.segments?.[0].tools[0].toolName).toBe("CharacterList");
    expect(assistant.segments?.[1].tools.map((t) => t.toolName)).toEqual(["NovelOutlineRead", "NovelVolumeRead"]);
  });

  it("maps proposal and text cards into rich descriptors by sequence window", () => {
    const items = mapProjectionTimeline(
      projection({
        cards: [
          {
            cardId: "CARD-MANUSCRIPT",
            kind: "proposal",
            sourceSequence: 2,
            sourceEventId: "e1",
            toolName: "ParagraphWrite",
            title: "正文",
            status: "in-progress",
          },
          {
            cardId: "CARD-CHAR",
            kind: "proposal",
            sourceSequence: 3,
            sourceEventId: "e2",
            toolName: "CharacterWrite",
            title: "角色",
            summary: "林晓 定稿",
            status: "completed",
          },
          {
            cardId: "CARD-READ",
            kind: "text",
            sourceSequence: 4,
            sourceEventId: "e3",
            toolName: "CharacterList",
            title: "角色",
            summary: "林夏、苏眉",
            status: "completed",
          },
          {
            cardId: "CARD-NOSUM",
            kind: "text",
            sourceSequence: 5,
            sourceEventId: "e4",
            toolName: "OutlineRead",
            title: "大纲",
            status: "completed",
          },
          {
            cardId: "CARD-OUT",
            kind: "text",
            sourceSequence: 9,
            sourceEventId: "e5",
            toolName: "VolumeRead",
            title: "卷",
            status: "completed",
          },
        ],
        timeline: [
          {
            kind: "user",
            sequence: 1,
            text: "把雨景改成夜景",
            timestamp: "2026-08-05T09:00:00.000Z",
          },
          {
            kind: "assistant",
            sequence: 2,
            text: "已按大纲调整。",
            streaming: false,
            sourceSequence: 2,
            turnEndSequence: 8,
            timestamp: "2026-08-05T09:00:01.000Z",
          },
        ],
      }),
      "Novel Agent",
    );
    const assistant = items.find((item) => item.kind === "assistant");
    expect(assistant).toBeDefined();
    if (assistant === undefined || assistant.kind !== "assistant") return;
    // CARD-OUT（seq 9）在窗口 [2, 8] 之外，排除。
    expect(assistant.cards).toHaveLength(4);
    // proposal in-progress → tag=plan，meta 取 toolName
    expect(assistant.cards[0]).toEqual({
      kind: "proposal",
      id: "CARD-MANUSCRIPT",
      content: {
        tag: "plan",
        title: "正文",
        meta: "ParagraphWrite",
        ops: [],
      },
    });
    // proposal completed → tag=applied
    expect(assistant.cards[1]).toEqual({
      kind: "proposal",
      id: "CARD-CHAR",
      content: {
        tag: "applied",
        title: "角色",
        meta: "CharacterWrite",
        ops: [],
      },
    });
    // text 卡 richText 取 summary
    expect(assistant.cards[2]).toEqual({
      kind: "text",
      id: "CARD-READ",
      content: {
        richText: { kind: "text", text: "林夏、苏眉" },
      },
    });
    // text 卡无 summary → richText 回退 title
    expect(assistant.cards[3]).toEqual({
      kind: "text",
      id: "CARD-NOSUM",
      content: {
        richText: { kind: "text", text: "大纲" },
      },
    });
  });

  it("keeps timeline append order (no re-sort)", () => {
    // 乱序输入：mapper 输出保持追加序（渲染层据此去掉了全量 sort，见 docs/PRD/gui-performance.md）
    const items = mapProjectionTimeline(
      projection({
        timeline: [
          {
            kind: "assistant",
            sequence: 2,
            text: "晚到的答复",
            streaming: false,
            timestamp: "2026-08-05T09:00:01.000Z",
          },
          {
            kind: "user",
            sequence: 1,
            text: "先发的问题",
            timestamp: "2026-08-05T09:00:00.000Z",
          },
        ],
      }),
      "Novel Agent",
    );
    expect(items[0].kind).toBe("assistant");
    expect(items[1].kind).toBe("turn");
    expect(items[2].kind).toBe("user");
  });

  it("caches mapped items per core item (stable references for memo)", () => {
    const snapshot = projection({
      timeline: [
        {
          kind: "user",
          sequence: 1,
          text: "继续",
          timestamp: "2026-08-05T09:00:00.000Z",
        },
        { kind: "assistant", sequence: 2, text: "好。", streaming: false },
      ],
    });
    const first = mapProjectionTimeline(snapshot, "Novel Agent");
    const second = mapProjectionTimeline(snapshot, "Novel Agent");
    // 同一 core 项 → 同一映射结果引用（UI 项跨快照恒定 → React.memo 浅比较命中）
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toBe(second[1]);
    expect(first[2]).toBe(second[2]);
  });
});
