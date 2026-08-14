/**
 * ToolStrip 渲染测试。
 * （RuntimeEventFlow「本轮时序」面板已移除，工具调用条内联在助手消息正文后。）
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolStrip } from "../../../src/domains/conversation/components/ToolStrip.js";

describe("ToolStrip", () => {
  it("aggregates chips and expands result rows", () => {
    render(
      <ToolStrip
        traces={[
          {
            traceId: "t1",
            toolName: "CharacterList",
            outcome: "ok",
            durationMs: 1200,
          },
          {
            traceId: "t2",
            toolName: "CharacterList",
            outcome: "failed",
            durationMs: 800,
          },
        ]}
      />,
    );
    const chip = screen.getByRole("button", { name: /CharacterList/ });
    expect(chip).toHaveTextContent("×2");
    expect(chip).toHaveTextContent("失败 1");
    fireEvent.click(chip);
    expect(screen.getAllByText(/CharacterList/).length).toBeGreaterThan(1);
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
