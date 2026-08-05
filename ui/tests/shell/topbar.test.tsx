/**
 * topbar 组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "../../src/shell/topbar/TopBar.js";
import { TopBarAction } from "../../src/shell/topbar/TopBarAction.js";
import { TopBarViewSwitcher } from "../../src/shell/topbar/TopBarViewSwitcher.js";

describe("TopBar", () => {
  it("renders workspace label, switcher and actions", () => {
    render(
      <TopBar
        mainViewState="chat"
        onMainViewChange={vi.fn()}
        workspaceLabel="白昼计划"
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "内容" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("switches the main view", async () => {
    const user = userEvent.setup();
    const onMainViewChange = vi.fn();
    render(
      <TopBar
        mainViewState="chat"
        onMainViewChange={onMainViewChange}
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "计划" }));
    expect(onMainViewChange).toHaveBeenCalledWith("schedule");
  });
});

describe("TopBarAction", () => {
  it("renders badge and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<TopBarAction label="审批" badge={3} onClick={onClick} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /审批/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("TopBarViewSwitcher", () => {
  it("marks the active tab selected", () => {
    render(<TopBarViewSwitcher state="content" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "内容" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "false");
  });
});
