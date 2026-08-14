/**
 * topbar 组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "../../src/shell/topbar/TopBar.js";
import { TopBarAction } from "../../src/shell/topbar/TopBarAction.js";

describe("TopBar", () => {
  it("renders wordmark, workspace name, view switcher and actions", () => {
    render(
      <TopBar
        workspaceName="白昼计划"
        workspaceSub="第三卷 · 回声"
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        view="chat"
        onViewChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByText("第三卷 · 回声")).toBeInTheDocument();
    // 中央分段切换器：三个视图 tab，当前视图 aria-selected
    expect(screen.getByRole("tab", { name: "对话" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "内容" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "计划" }).getAttribute("aria-selected")).toBe("false");
    // 审批入口已移除：待审批时右侧面板自动展开（见 ApplicationShell 自动展开 effect）。
    expect(screen.queryByRole("button", { name: "审批" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("fires onViewChange when a view tab is clicked", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(
      <TopBar
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        view="chat"
        onViewChange={onViewChange}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "计划" }));
    expect(onViewChange).toHaveBeenCalledWith("schedule");
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
