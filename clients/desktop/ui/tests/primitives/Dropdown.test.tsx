/**
 * Dropdown 组件测试：展开、item 选择、disabled、外点关闭。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown, DropdownItem, DropdownSeparator } from "../../src/shared/primitives/Dropdown.js";

describe("Dropdown", () => {
  it("opens on trigger click and selects an item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Dropdown trigger={<button type="button">⋯</button>}>
        <DropdownItem label="删除" onSelect={onSelect} danger />
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "⋯" }));
    const item = screen.getByText("删除");
    expect(item).toBeInTheDocument();
    await user.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders separators and does not fire disabled items", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Dropdown trigger={<button type="button">⋯</button>}>
        <DropdownItem label="重命名" onSelect={onSelect} />
        <DropdownSeparator />
        <DropdownItem label="删除" onSelect={onSelect} disabled />
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "⋯" }));
    expect(screen.getByText("重命名")).toBeInTheDocument();
    await user.click(screen.getByText("删除"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<button type="button">⋯</button>}>
        <DropdownItem label="删除" onSelect={vi.fn()} />
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "⋯" }));
    expect(screen.getByText("删除")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
  });
});
