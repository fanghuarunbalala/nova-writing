/**
 * topbar 组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "../../src/shell/topbar/TopBar.js";
import { TopBarAction } from "../../src/shell/topbar/TopBarAction.js";

describe("TopBar", () => {
  it("renders wordmark, workspace name and actions", () => {
    const onOpenSchedule = vi.fn();
    const onOpenApproval = vi.fn();
    render(
      <TopBar
        workspaceName="白昼计划"
        workspaceSub="第三卷 · 回声"
        revision="r042"
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenSchedule={onOpenSchedule}
        onOpenApproval={onOpenApproval}
      />,
    );
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByText("第三卷 · 回声")).toBeInTheDocument();
    expect(screen.getByText("r042")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "计划" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审批" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("omits schedule/approval actions when handlers are absent", () => {
    render(
      <TopBar
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "计划" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审批" })).not.toBeInTheDocument();
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
