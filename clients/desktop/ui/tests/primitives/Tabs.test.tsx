/**
 * Tabs 组件测试：受控切换、count badge、disabled。
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsContent } from "../../src/shared/primitives/Tabs.js";

function Harness() {
  const [value, setValue] = useState("a");
  return (
    <Tabs
      value={value}
      onValueChange={setValue}
      tabs={[
        { value: "a", label: "对话", count: 3 },
        { value: "b", label: "内容" },
        { value: "c", label: "计划", disabled: true },
      ]}
    >
      <TabsContent value="a">对话面板</TabsContent>
      <TabsContent value="b">内容面板</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders tab triggers with badge and switches content", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.getByLabelText("3 项")).toHaveTextContent("3");
    expect(screen.getByText("对话面板")).toBeInTheDocument();
    await user.click(screen.getByText("内容"));
    expect(screen.getByText("内容面板")).toBeInTheDocument();
    expect(screen.queryByText("对话面板")).not.toBeInTheDocument();
  });

  it("does not switch to a disabled tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("计划"));
    expect(screen.queryByText("对话面板")).toBeInTheDocument();
  });

  it("calls onValueChange from the parent", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Tabs
        value="a"
        onValueChange={onValueChange}
        tabs={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
      >
        <TabsContent value="a">A</TabsContent>
        <TabsContent value="b">B</TabsContent>
      </Tabs>,
    );
    await user.click(screen.getByText("B"));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});
