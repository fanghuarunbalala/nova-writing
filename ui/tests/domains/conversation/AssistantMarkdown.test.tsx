/**
 * AssistantMarkdown 渲染测试。
 * Rendering tests for the assistant markdown component.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantMarkdown } from "../../../src/domains/conversation/components/assistantContent/AssistantMarkdown.js";

describe("AssistantMarkdown", () => {
  it("引用标签渲染为 chip，Markdown 正常渲染", () => {
    render(
      <AssistantMarkdown
        text={"他看向<character id=\"ch-3\">阿七</character>。\n\n**重点**"}
      />,
    );
    expect(screen.getByText("阿七")).toBeTruthy();
    expect(screen.getByText("重点")).toBeTruthy();
    expect(screen.queryByText(/cc:\/\//)).toBeNull();
  });

  it("点击 chip 触发回调", () => {
    const onClick = vi.fn();
    render(
      <AssistantMarkdown
        text={"<outline id=\"out-1\">主线</outline>"}
        onReferenceClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText("主线"));
    expect(onClick).toHaveBeenCalledWith({
      refKind: "outline",
      id: "out-1",
      label: "主线",
    });
  });

  it("chapter 引用渲染为 chip", () => {
    render(
      <AssistantMarkdown text={"<chapter id=\"chapter-301\">第一章</chapter>"} />,
    );
    expect(screen.getByText("第一章")).toBeTruthy();
  });

  it("自闭合引用从 resolver 取档案名，missing 态标记未建档", () => {
    const resolveReference = (ref: { refKind: "character" | "location" | "outline" | "chapter" | "paragraph"; id: string }) =>
      ref.id === "loc-7"
        ? { label: "旧船坞 7 号", known: true }
        : { label: "失踪的船员", known: false };
    render(
      <AssistantMarkdown
        text={"<location id=\"loc-7\"/> 与 <character id=\"char-x\">失踪的船员</character>"}
        resolveReference={resolveReference}
      />,
    );
    expect(screen.getByText("旧船坞 7 号")).toBeTruthy();
    expect(screen.getByText("失踪的船员").closest("button")).toHaveAttribute(
      "title",
      "暂未建立「失踪的船员」的档案",
    );
  });

  it("流式封存：跨段落边界增长时已封段文本保留、引用 chip 正常渲染", () => {
    // 三段文本 + 跨段的引用标签整体在首段（封存不拆标签）
    const longText =
      "第一段开头，介绍<character id=\"ch-1\">阿七</character>的来历，" +
      "文字略长以形成段落。\n\n第二段继续，流式追加中的尾段。";
    const { rerender } = render(<AssistantMarkdown text={longText} streaming />);
    expect(screen.getByText("阿七")).toBeTruthy();
    expect(screen.getByText("第二段继续，流式追加中的尾段。")).toBeTruthy();

    // 尾段继续增长：前缀不变（memo 命中），新内容照常渲染
    rerender(
      <AssistantMarkdown
        text={`${longText}又写了一句话。`}
        streaming
      />,
    );
    expect(screen.getByText("第二段继续，流式追加中的尾段。又写了一句话。")).toBeTruthy();
    expect(screen.getByText("阿七")).toBeTruthy();
  });

  it("流式封存边界避开未闭合引用标签：标签跨候选边界时不拆分", () => {
    // 引用标签的内部文本跨过段落边界 → 封存点应回退到标签之前（chip 完整渲染）
    const text = "第一段。<character id=\"ch-2\">跨段\n\n名字</character>尾段。";
    render(<AssistantMarkdown text={text} streaming />);
    // chip 未被拆开：按钮内是完整标签内部文本（跨段 + 名字）
    const chip = screen.getByRole("button");
    expect(chip.textContent).toContain("跨段");
    expect(chip.textContent).toContain("名字");
  });
});
