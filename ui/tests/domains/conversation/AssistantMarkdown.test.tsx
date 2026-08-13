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
});
