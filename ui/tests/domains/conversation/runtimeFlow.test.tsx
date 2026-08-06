/**
 * RuntimeEventFlow / ToolStrip 渲染测试。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RuntimeEventFlow } from "../../../src/domains/conversation/components/RuntimeEventFlow.js";
import { ToolStrip } from "../../../src/domains/conversation/components/ToolStrip.js";

describe("RuntimeEventFlow", () => {
  it("renders nothing without events and collapses rows by default", () => {
    const { rerender } = render(<RuntimeEventFlow events={[]} />);
    expect(screen.queryByText("本轮时序")).not.toBeInTheDocument();
    rerender(
      <RuntimeEventFlow
        events={[
          {
            sequence: 2,
            timestamp: Date.parse("2026-08-05T09:00:01.000Z"),
            eventType: "agent.run.state.changed",
            family: "agent",
            summary: "— → running",
          },
        ]}
      />,
    );
    expect(screen.getByText("本轮时序")).toBeInTheDocument();
    expect(screen.queryByText("agent.run.state.changed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开本轮时序" }));
    expect(screen.getByText("agent.run.state.changed")).toBeInTheDocument();
    expect(screen.getByText("— → running")).toBeInTheDocument();
  });
});

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
