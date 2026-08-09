/**
 * conversation 域组件测试：timeline/user/assistant/think/proposal/gen/composer/empty。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatEmptyState } from "../../../src/domains/conversation/components/ChatEmptyState.js";
import { ConversationComposer } from "../../../src/domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../../src/domains/conversation/components/ConversationTimeline.js";
import { GenStatus } from "../../../src/domains/conversation/components/GenStatus.js";
import { ProposalBlock } from "../../../src/domains/conversation/components/ProposalBlock.js";
import { ProposalOp } from "../../../src/domains/conversation/components/ProposalOp.js";
import { ThinkBlock } from "../../../src/domains/conversation/components/ThinkBlock.js";
import { ThinkLine } from "../../../src/domains/conversation/components/ThinkLine.js";
import { UserMessage } from "../../../src/domains/conversation/components/UserMessage.js";
import type { ConversationTimelineItem } from "../../../src/domains/conversation/projection/ConversationTimelineItem.js";

function makeLines(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    text: `思考行 ${index}`,
  }));
}

describe("ConversationTimeline", () => {
  it("renders items in sequence order", () => {
    const items: ConversationTimelineItem[] = [
      { kind: "user", sequence: 2, text: "第二条", timestamp: 200 },
      { kind: "assistant", sequence: 1, agentLabel: "Novel Agent", timestamp: 100, thinkLines: [], text: "第一条", cards: [], streaming: false },
      { kind: "system", sequence: 3, text: "已提交 r042", timestamp: 300 },
    ];
    render(<ConversationTimeline conversationId="c1" items={items} />);
    const textNodes = screen.getAllByText(/第.条|已提交/);
    expect(textNodes.map((node) => node.textContent)).toEqual(["第一条", "第二条", "已提交 r042"]);
  });

  it("forwards proposal view-diff actions", async () => {
    const user = userEvent.setup();
    const onProposalAction = vi.fn();
    const items: ConversationTimelineItem[] = [
      {
        kind: "assistant",
        sequence: 1,
        agentLabel: "Novel Agent",
        timestamp: 100,
        thinkLines: [],
        text: "",
        streaming: false,
        cards: [
          {
            kind: "proposal",
            id: "card-1",
            content: {
              tag: "proposal",
              title: "调整雨景",
              changeSetId: "CS-1",
              ops: [],
            },
          },
        ],
      },
    ];
    render(<ConversationTimeline conversationId="c1" items={items} onProposalAction={onProposalAction} />);
    await user.click(screen.getByRole("button", { name: "前往审批 Diff" }));
    expect(onProposalAction).toHaveBeenCalledWith("CS-1", "view-diff");
  });
});

describe("UserMessage", () => {
  it("renders text and inline reference chips", async () => {
    const user = userEvent.setup();
    const onReferenceClick = vi.fn();
    render(
      <UserMessage
        sequence={1}
        text={'把<character id="char-linxia">林夏</character>的伞拿走'}
        timestamp={1000}
        onReferenceClick={onReferenceClick}
      />,
    );
    expect(screen.getByText(/把/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "林夏" }));
    expect(onReferenceClick).toHaveBeenCalledWith({
      refKind: "character",
      id: "char-linxia",
      label: "林夏",
    });
  });

  it("renders chapter and self-closing reference chips", async () => {
    const user = userEvent.setup();
    const onReferenceClick = vi.fn();
    const resolveReference = () => ({ label: "第一章 · 旧船坞", known: true });
    render(
      <UserMessage
        sequence={2}
        text={'翻到<chapter id="chapter-301">第一章</chapter>和<location id="loc-dock7"/>。'}
        timestamp={1000}
        onReferenceClick={onReferenceClick}
        resolveReference={resolveReference}
      />,
    );
    await user.click(screen.getByRole("button", { name: "第一章" }));
    expect(onReferenceClick).toHaveBeenCalledWith({
      refKind: "chapter",
      id: "chapter-301",
      label: "第一章",
    });
    await user.click(screen.getByRole("button", { name: "第一章 · 旧船坞" }));
    expect(onReferenceClick).toHaveBeenCalledWith({
      refKind: "location",
      id: "loc-dock7",
    });
  });
});

describe("ThinkBlock / ThinkLine", () => {
  it("shows the last three lines when collapsed and all when expanded", async () => {
    const user = userEvent.setup();
    const lines = makeLines(5);
    render(<ThinkBlock lines={lines} expanded={false} onToggle={() => undefined} />);
    expect(screen.queryByText("思考行 0")).not.toBeInTheDocument();
    expect(screen.getByText("思考行 4")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /展开/ });
    await user.click(toggle);
    expect(screen.getByText("思考行 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /收起/ })).toBeInTheDocument();
  });

  it("shows all lines when fewer than three", () => {
    render(<ThinkBlock lines={makeLines(2)} expanded={false} onToggle={() => undefined} />);
    expect(screen.getByText("思考行 0")).toBeInTheDocument();
    expect(screen.getByText("思考行 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /展开/ })).not.toBeInTheDocument();
  });

  it("renders a single think line with tag", () => {
    render(<ThinkLine line={{ id: "t1", text: "节奏放缓", tag: "节奏" }} />);
    expect(screen.getByText("节奏")).toBeInTheDocument();
    expect(screen.getByText("节奏放缓")).toBeInTheDocument();
  });
});

describe("ProposalBlock / ProposalOp", () => {
  it("renders tag, title, meta and ops, and fires view-diff", async () => {
    const user = userEvent.setup();
    const onViewDiff = vi.fn();
    render(
      <ProposalBlock
        tag="proposal"
        title="调整雨景描写"
        meta="r041 -> r042"
        changeSetId="CS-1"
        onViewDiff={onViewDiff}
        ops={[{ id: "op-1", mark: "mod", kind: "manuscript", description: { kind: "text", text: "把'雨很大'改为'雨落得密'" } }]}
      />,
    );
    expect(screen.getByText("调整雨景描写")).toBeInTheDocument();
    expect(screen.getByText("r041 -> r042")).toBeInTheDocument();
    expect(screen.getByText("~")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前往审批 Diff" }));
    expect(onViewDiff).toHaveBeenCalledWith("CS-1");
  });

  it("ProposalOp renders mark, description and kind", () => {
    render(
      <ProposalOp
        op={{ id: "op-2", mark: "add", kind: "character", description: { kind: "text", text: "新增角色 林夏" } }}
      />,
    );
    expect(screen.getByText("+")).toBeInTheDocument();
    expect(screen.getByText("新增角色 林夏")).toBeInTheDocument();
    expect(screen.getByText("角色")).toBeInTheDocument();
  });
});

describe("GenStatus", () => {
  it("renders nothing when idle", () => {
    render(<GenStatus phase="idle" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows stage, elapsed clock and stop while live, then retry on failure", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <GenStatus phase="thinking" stage="正在思考大纲…" onStop={onStop} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("正在思考大纲…");
    expect(screen.getByText(/已用时 0s/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(<GenStatus phase="failed" error="连接中断" onRetry={onRetry} />);
    expect(screen.getByText("生成失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationComposer", () => {
  it("submits trimmed text on Enter and clears the input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ConversationComposer conversationId="c1" enabled onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "  改写雨景  ");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "改写雨景", references: [] });
    expect(input).toHaveValue("");
  });

  it("disables send when empty or disabled", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const { rerender } = render(<ConversationComposer conversationId="c1" enabled onSend={onSend} />);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    rerender(<ConversationComposer conversationId="c1" enabled={false} onSend={onSend} />);
    await user.type(screen.getByRole("textbox"), "hi");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("renders the generation status pill above the input when status is provided", () => {
    const onSend = vi.fn();
    render(
      <ConversationComposer
        conversationId="c1"
        enabled
        onSend={onSend}
        status={{ phase: "streaming", onStop: () => undefined }}
      />,
    );
    expect(screen.getByText("正在生成…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
  });
});

describe("ChatEmptyState", () => {
  it("prompts creation and fires onCreate", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<ChatEmptyState onCreate={onCreate} />);
    expect(screen.getByText("新对话")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
