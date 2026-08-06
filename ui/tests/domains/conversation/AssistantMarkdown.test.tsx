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
});
