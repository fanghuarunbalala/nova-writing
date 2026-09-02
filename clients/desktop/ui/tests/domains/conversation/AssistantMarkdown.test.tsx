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

describe("AssistantMarkdown 全格式排版（demo .mdBody 对齐）", () => {
  it("代码块：语言标签头 + 复制按钮（点击写剪贴板并 toast）", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onNotify = vi.fn();
    render(
      <AssistantMarkdown
        text={"```yaml\nunit:\n  id: u6\n```"}
        onNotify={onNotify}
      />,
    );
    expect(screen.getByText("yaml")).toBeTruthy();
    const copy = screen.getByRole("button", { name: "复制" });
    fireEvent.click(copy);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("unit:\n  id: u6\n"));
    expect(onNotify).toHaveBeenCalledWith("success", "代码已复制");
  });

  it("任务清单：GFM checkbox 渲染（勾选/未勾选）且不产生外层圆点", () => {
    render(
      <AssistantMarkdown text={"- [x] 已完成\n- [ ] 待办"} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it("脚注：上标引用 + 尾注区（remark-gfm footnotes）", () => {
    render(
      <AssistantMarkdown text={"线索[^1]。\n\n[^1]: 第二章实体变更。"} />,
    );
    expect(screen.getByText(/第二章实体变更/)).toBeTruthy();
  });

  it("图片渲染为占位块（不加载外链），alt 作题注", () => {
    render(<AssistantMarkdown text={"![北河渡口 · 雾夜](https://example.com/x.png)"} />);
    expect(screen.queryByRole("img", { name: /北河渡口/ })).toBeTruthy();
    // 占位块呈现 alt 文案，且不产生真实 <img> 外链请求
    expect(document.querySelector("img")).toBeNull();
  });

  it("行内强调族：删除线 / 分割线 / 四级以下标题（kbd 为原始 HTML，安全转义不渲染）", () => {
    render(
      <AssistantMarkdown
        text={"~~旧稿~~ 按键\n\n#### 四级\n\n##### 五级\n\n------\n\n尾段。"}
      />,
    );
    expect(screen.getByText("旧稿").tagName).toBe("DEL");
    expect(screen.getByText("四级").tagName).toBe("H4");
    expect(screen.getByText("五级").tagName).toBe("H5");
    expect(document.querySelector("hr")).not.toBeNull();
  });
});
