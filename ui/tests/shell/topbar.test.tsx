/**
 * topbar 组件测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "../../src/shell/topbar/TopBar.js";
import { TopBarAction } from "../../src/shell/topbar/TopBarAction.js";
import { TopBarViewSwitcher } from "../../src/shell/topbar/TopBarViewSwitcher.js";
import {
  NotificationStore,
  type NotificationItem,
} from "../../src/domains/notification/store/NotificationStore.js";

describe("TopBar", () => {
  it("renders brand, workspace chip, view switcher and actions", () => {
    render(
      <TopBar
        workspaceName="白昼计划"
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
    // 中央分段切换器：三个视图 tab，当前视图 aria-selected
    expect(screen.getByRole("tab", { name: "对话" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "内容" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "计划" }).getAttribute("aria-selected")).toBe("false");
    // 审批入口已移除：待审批时右侧面板自动展开（见 ApplicationShell 自动展开 effect）。
    expect(screen.queryByRole("button", { name: "审批" })).not.toBeInTheDocument();
    // 右侧动作对齐 demo：纯图标钮（IconButton aria-label）
    expect(screen.getByRole("button", { name: "打开工作区" })).toBeInTheDocument();
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

describe("TopBarViewSwitcher（书库 debug 门控列数）", () => {
  it("libraryEnabled=false（缺省）：只渲染三视图，无书库空槽，列数为 3", () => {
    const { container } = render(
      <TopBarViewSwitcher state="chat" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("tab", { name: "对话" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "内容" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "计划" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "书库" })).not.toBeInTheDocument();
    const switcher = container.querySelector("[role=tablist]");
    expect(switcher).not.toBeNull();
    expect(switcher?.getAttribute("style")).toContain("--view-count: 3");
  });

  it("libraryEnabled=true：渲染四视图，列数为 4", () => {
    const { container } = render(
      <TopBarViewSwitcher state="chat" onChange={vi.fn()} libraryEnabled />,
    );
    expect(screen.getByRole("tab", { name: "书库" })).toBeInTheDocument();
    const switcher = container.querySelector("[role=tablist]");
    expect(switcher?.getAttribute("style")).toContain("--view-count: 4");
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

describe("TopBar 通知中心（铃铛）", () => {
  function notifItem(id: string, overrides: Partial<NotificationItem> = {}): NotificationItem {
    return {
      id,
      type: "approval",
      title: `通知 ${id}`,
      desc: "描述",
      createdAt: 1_000,
      read: false,
      ...overrides,
    };
  }

  it("未传 notifications 时不渲染铃铛", () => {
    render(
      <TopBar
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        view="chat"
        onViewChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "通知中心" })).not.toBeInTheDocument();
  });

  it("铃铛角标显示未读数；下拉含条目、全部已读与设置入口", async () => {
    const user = userEvent.setup();
    const store = new NotificationStore();
    store.upsert(notifItem("a"));
    store.upsert(notifItem("b", { read: true }));
    render(
      <TopBar
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        view="chat"
        onViewChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
        notifications={store}
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument(); // 角标 = 未读数

    await user.click(screen.getByRole("button", { name: "通知中心" }));
    expect(await screen.findByText("通知 a")).toBeInTheDocument();
    expect(screen.getByText("通知 b")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部已读" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /通知设置/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部已读" }));
    expect(store.getSnapshot().unreadCount).toBe(0);
  });

  it("点击通知条目 → markRead + onNotificationActivate", async () => {
    const user = userEvent.setup();
    const onNotificationActivate = vi.fn();
    const store = new NotificationStore();
    store.upsert(notifItem("a"));
    render(
      <TopBar
        sidebarMode="expanded"
        onToggleSidebar={vi.fn()}
        view="chat"
        onViewChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
        notifications={store}
        onNotificationActivate={onNotificationActivate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "通知中心" }));
    await user.click(await screen.findByRole("menuitem", { name: /通知 a/ }));
    expect(store.getSnapshot().items[0]!.read).toBe(true);
    expect(onNotificationActivate).toHaveBeenCalledTimes(1);
  });
});
