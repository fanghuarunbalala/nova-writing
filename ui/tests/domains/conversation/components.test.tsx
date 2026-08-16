/**
 * conversation 域组件测试：timeline/user/assistant/proposal/gen/composer/empty。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatEmptyState } from "../../../src/domains/conversation/components/ChatEmptyState.js";
import { ConversationComposer } from "../../../src/domains/conversation/components/ConversationComposer.js";
import { ConversationTimeline } from "../../../src/domains/conversation/components/ConversationTimeline.js";
import { GenStatus } from "../../../src/domains/conversation/components/GenStatus.js";
import { QueuedUserMessage } from "../../../src/domains/conversation/components/QueuedUserMessage.js";
import { UserMessage } from "../../../src/domains/conversation/components/UserMessage.js";
import type { ConversationTimelineItem } from "../../../src/domains/conversation/projection/ConversationTimelineItem.js";

describe("ConversationTimeline", () => {
  it("renders items in the provided order (mapper append-order invariant, no re-sort)", () => {
    // 故意乱序输入：时间线不再 sort，渲染顺序 = 输入顺序（chatSurfaceMapper 保证追加序）
    const items: ConversationTimelineItem[] = [
      { kind: "assistant", sequence: 2, agentLabel: "Novel Agent", timestamp: 200, text: "第二条", cards: [], streaming: false },
      { kind: "user", sequence: 1, text: "第一条", timestamp: 100 },
      { kind: "system", sequence: 3, text: "已提交 r042", timestamp: 300 },
    ];
    render(<ConversationTimeline conversationId="c1" items={items} />);
    const textNodes = screen.getAllByText(/第.条|已提交/);
    expect(textNodes.map((node) => node.textContent)).toEqual(["第二条", "第一条", "已提交 r042"]);
  });

  it("suppresses entry animation for initial items and animates appended ones (视图切换不重播级联)", () => {
    const base: ConversationTimelineItem[] = [
      { kind: "user", sequence: 1, text: "第一条", timestamp: 100 },
      { kind: "assistant", sequence: 2, agentLabel: "Novel Agent", timestamp: 200, text: "第二条", cards: [], streaming: false },
    ];
    const { container, rerender } = render(<ConversationTimeline conversationId="c1" items={base} />);
    // 初始项（挂载时已在列）：enterStatic——容器 view-in 已承担整体淡入
    expect(container.querySelectorAll(".enterStatic").length).toBe(2);
    expect(container.querySelectorAll(".enter").length).toBe(0);

    // 追加项：逐条入场（enter + 错峰 delay）
    rerender(
      <ConversationTimeline
        conversationId="c1"
        items={[...base, { kind: "user", sequence: 3, text: "新到", timestamp: 300 }]}
      />,
    );
    expect(container.querySelectorAll(".enterStatic").length).toBe(2);
    expect(container.querySelectorAll(".enter").length).toBe(1);

    // 会话切换：初始集合按挂载会话绑定，切走后全量入场（级联保留）
    rerender(<ConversationTimeline conversationId="c2" items={base} />);
    expect(container.querySelectorAll(".enter").length).toBe(2);
    expect(container.querySelectorAll(".enterStatic").length).toBe(0);
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

  it("排队幽灵项渲染在流式回复之后（生成中发送的本地回显）", () => {
    const items: ConversationTimelineItem[] = [
      { kind: "user", sequence: 1, text: "上一条", timestamp: 100 },
      {
        kind: "assistant",
        sequence: 2,
        agentLabel: "Novel Agent",
        timestamp: 200,
        text: "正在流式的回复",
        cards: [],
        streaming: true,
      },
      { kind: "queued", sequence: 9_000_001, text: "排队消息内容", queuedAt: 1_000 },
    ];
    render(<ConversationTimeline conversationId="c1" items={items} />);
    // 角标是气泡子元素（demo 同构）：「排队中」与秒数是角标内的直接文本
    expect(screen.getByText("排队中")).toBeInTheDocument();
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument();
    const nodes = screen.getAllByText(/正在流式的回复|排队消息内容/);
    expect(nodes.map((node) => node.textContent)).toEqual([
      "正在流式的回复",
      expect.stringContaining("排队消息内容"),
    ]);
  });
});

describe("QueuedUserMessage", () => {
  it("renders ghost bubble text and queueing badge", () => {
    render(<QueuedUserMessage text="第三卷结尾改成开放式" queuedAt={Date.now()} />);
    expect(screen.getByText(/第三卷结尾改成开放式/)).toBeInTheDocument();
    expect(screen.getByText("排队中")).toBeInTheDocument();
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument();
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

  it("copies text via clipboard and notifies on success", async () => {
    const user = userEvent.setup();
    const onNotify = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <UserMessage
        sequence={3}
        text="把货单交给林夏"
        timestamp={1000}
        onNotify={onNotify}
      />,
    );
    await user.click(screen.getByRole("button", { name: "复制消息" }));
    expect(writeText).toHaveBeenCalledWith("把货单交给林夏");
    expect(onNotify).toHaveBeenCalledWith("success", "已复制消息");
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("renders in-pad copy button on the first user message", () => {
    render(<UserMessage sequence={1} text="开场" timestamp={1000} inPad />);
    expect(screen.getByRole("button", { name: "复制消息" })).toBeInTheDocument();
  });
});

describe("GenStatus", () => {
  it("shows the generating indicator with elapsed seconds", () => {
    render(<GenStatus phase="generating" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在生成");
    expect(screen.getByRole("status")).toHaveTextContent(/0s/);
  });

  it("shows the waiting indicator without seconds", () => {
    render(<GenStatus phase="waiting" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在审批");
    expect(screen.getByRole("status")).not.toHaveTextContent(/s$/);
  });

  it("renders failure detail with retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<GenStatus phase="failed" error="连接中断" onRetry={onRetry} />);
    expect(screen.getByText("生成失败")).toBeInTheDocument();
    expect(screen.getByText("连接中断")).toBeInTheDocument();
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

  it("disables send during pending approval but keeps typing and mode available", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ConversationComposer
        conversationId="c1"
        enabled
        sendDisabled
        onSend={onSend}
        onModeChange={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "hi");
    // 发送按钮禁用，但打字区仍可用，显示「正在审批」。
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(input).toBeEnabled();
    expect(screen.getByText("正在审批")).toBeInTheDocument();
    // 切 mode 的触发按钮仍可用。
    expect(screen.getByRole("button", { name: /执行模式|模式|下拉/ })).toBeEnabled();
  });

  it("unlocks send and shows the disconnected hint when the runtime is disconnected", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ConversationComposer
        conversationId="c1"
        enabled
        sendDisabled
        disconnected
        onSend={onSend}
      />,
    );
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "hi");
    // 断开时审批阻塞解除：发送可用、显示「进程已断开」，不显示「正在审批」。
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
    expect(screen.getByText("进程已断开，审批已结束")).toBeInTheDocument();
    expect(screen.queryByText("正在审批")).not.toBeInTheDocument();
  });

  it("renders the generation status pill above the input when status is provided", () => {
    const onSend = vi.fn();
    render(
      <ConversationComposer
        conversationId="c1"
        enabled
        onSend={onSend}
        status={{ phase: "generating" }}
      />,
    );
    expect(screen.getByText("正在生成")).toBeInTheDocument();
    // 停止按钮已随新三态语言移除（生成中不可手动中止）。
    expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
  });
});

describe("ChatEmptyState", () => {
  it("prompts creation and fires onCreate", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<ChatEmptyState onCreate={onCreate} />);
    expect(screen.getByText("开始一段新的创作")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

