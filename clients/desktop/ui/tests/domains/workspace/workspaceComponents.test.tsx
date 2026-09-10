/**
 * workspace 域组件渲染测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectSelectionPage } from "../../../src/domains/workspace/components/ProjectSelectionPage.js";
import { WorkspaceFooting } from "../../../src/domains/workspace/components/WorkspaceFooting.js";
import { WorkspaceLabel } from "../../../src/domains/workspace/components/WorkspaceLabel.js";
import { WorkspaceRevisionMeta } from "../../../src/domains/workspace/components/WorkspaceRevisionMeta.js";
import { WorkspaceSelectionDialog } from "../../../src/domains/workspace/components/WorkspaceSelectionDialog.js";

describe("WorkspaceFooting", () => {
  it("renders label and meta and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<WorkspaceFooting workspaceId="w1" label="白昼计划" meta="r041 · 最后提交 14:02" onClick={onClick} />);
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByText("r041 · 最后提交 14:02")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceLabel", () => {
  it("renders full label and collapses to first char", () => {
    const { rerender } = render(<WorkspaceLabel label="白昼计划" />);
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    rerender(<WorkspaceLabel label="白昼计划" collapsed />);
    expect(screen.getByText("白")).toBeInTheDocument();
  });
});

describe("WorkspaceRevisionMeta", () => {
  it("renders revision and formatted commit time", () => {
    render(<WorkspaceRevisionMeta revision="r041" lastCommitAt={new Date(2026, 7, 5, 14, 2).getTime()} />);
    expect(screen.getByText("r041")).toBeInTheDocument();
    expect(screen.getByText("最后提交 14:02")).toBeInTheDocument();
  });

  it("renders only the revision when no timestamp is given", () => {
    render(<WorkspaceRevisionMeta revision="r041" />);
    expect(screen.getByText("r041")).toBeInTheDocument();
    expect(screen.queryByText(/最后提交/)).not.toBeInTheDocument();
  });
});

describe("ProjectSelectionPage（纯云端化 ⑥ 云-only）", () => {
  const snapshot = (overrides = {}) => ({
    revision: 1,
    phase: "idle",
    ...overrides,
  });

  const cloudSection = (overrides = {}) => ({
    projects: [
      { id: "prj_1", name: "云端测试书", lastActivityAt: Date.now(), archived: false, referenceId: "ws-1" },
    ],
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(async () => true),
    ...overrides,
  });

  const onlineAuth = { status: "online", url: "http://127.0.0.1:8787", username: "alice", deviceId: "d1" } as never;

  it("云端分区：品牌 + 云卡片 + 新建入口；本地入口不渲染；卡片打开回调", async () => {
    const user = userEvent.setup();
    const section = cloudSection();
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        serverAuthState={onlineAuth}
        onOpenLogin={vi.fn()}
        cloudSection={section}
      />,
    );
    expect(screen.getByText("把一桩旧事，写成一本新书。")).toBeInTheDocument();
    expect(screen.getByText("云端项目")).toBeInTheDocument();
    expect(screen.getByText("云端测试书")).toBeInTheDocument();
    // 本地入口退役
    expect(screen.queryByRole("button", { name: "新建项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开其他项目…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /从文件导入/ })).not.toBeInTheDocument();
    // 卡片打开
    await user.click(screen.getByRole("button", { name: /^云端测试书/ }));
    expect(section.onOpen).toHaveBeenCalledWith({ id: "prj_1", name: "云端测试书" });
  });

  it("新建云端项目：命名弹窗 → onCreate", async () => {
    const user = userEvent.setup();
    const section = cloudSection();
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        serverAuthState={onlineAuth}
        onOpenLogin={vi.fn()}
        cloudSection={section}
      />,
    );
    await user.click(screen.getByRole("button", { name: "新建云端项目" }));
    await user.type(screen.getByLabelText("项目名"), "雪落长街");
    await user.click(screen.getByRole("button", { name: "创建并打开" }));
    expect(section.onCreate).toHaveBeenCalledWith("雪落长街");
  });

  it("未登录：登录引导空态（不渲染云列表/新建）", () => {
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        serverAuthState={{ status: "unconfigured" } as never}
        onOpenLogin={vi.fn()}
        cloudSection={cloudSection()}
      />,
    );
    expect(screen.getByText(/登录后即可查看并打开你的云端项目/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建云端项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^云端测试书/ })).not.toBeInTheDocument();
  });

  it("老 main（cloudSection 缺省）：升级提示", () => {
    render(<ProjectSelectionPage snapshot={snapshot()} />);
    expect(screen.getByText(/当前应用版本不支持云端项目/)).toBeInTheDocument();
  });

  it("删除云项目：danger 确认（server 删除语义）后回调 onDelete", async () => {
    const user = userEvent.setup();
    const section = cloudSection();
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        serverAuthState={onlineAuth}
        onOpenLogin={vi.fn()}
        cloudSection={section}
      />,
    );
    await user.click(screen.getByRole("button", { name: "删除云端项目 云端测试书" }));
    expect(screen.getByText(/确定删除云端项目「云端测试书」/)).toBeInTheDocument();
    expect(screen.getByText(/所有设备不再可见/)).toBeInTheDocument();
    expect(section.onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "删除", exact: true }));
    expect(section.onDelete).toHaveBeenCalledWith("prj_1");
  });

  it("错误横幅与 busy 态", () => {
    render(
      <ProjectSelectionPage
        snapshot={{
          revision: 1,
          phase: "opening",
          error: { code: "OPEN_FAILED", retryable: true, message: "打开失败" },
        }}
        serverAuthState={onlineAuth}
        onOpenLogin={vi.fn()}
        cloudSection={cloudSection()}
      />,
    );
    expect(screen.getByText("打开失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^云端测试书/ })).toBeDisabled();
  });
});

describe("WorkspaceSelectionDialog（纯云端化 ⑥ 云列表）", () => {
  const snapshot = (overrides = {}) => ({
    revision: 1,
    phase: "ready",
    current: { id: "ws-cur", label: "当前书" },
    ...overrides,
  });

  function renderDialog(overrides: Partial<Parameters<typeof WorkspaceSelectionDialog>[0]> = {}) {
    return render(
      <WorkspaceSelectionDialog
        open
        snapshot={snapshot()}
        cloudProjects={{
          projects: [
            { id: "prj_cur", name: "当前书", lastActivityAt: null, archived: false, referenceId: "ws-cur" },
            { id: "prj_old", name: "旧书", lastActivityAt: null, archived: false, referenceId: "ws-old" },
          ],
          onOpen: vi.fn(),
          onOpenInNewWindow: vi.fn(),
          onDelete: vi.fn(async () => true),
        }}
        onCloseWorkspace={vi.fn()}
        onDismiss={vi.fn()}
        {...overrides}
      />,
    );
  }

  it("当前项目过滤（referenceId 匹配），其余云项目可进打开位置面板", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderDialog({ cloudProjects: {
      projects: [
        { id: "prj_cur", name: "当前书", lastActivityAt: null, archived: false, referenceId: "ws-cur" },
        { id: "prj_old", name: "旧书", lastActivityAt: null, archived: false, referenceId: "ws-old" },
      ],
      onOpen,
      onOpenInNewWindow: vi.fn(),
      onDelete: vi.fn(async () => true),
    } });
    // 当前项目不进列表（运行中保护）
    expect(screen.queryByRole("button", { name: /^当前书/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^旧书/ }));
    expect(screen.getByText(/打开《旧书》/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "在当前窗口打开" }));
    expect(onOpen).toHaveBeenCalledWith({ id: "prj_old", name: "旧书" });
  });

  it("新窗口打开派发 onOpenInNewWindow；删除走 danger 确认", async () => {
    const user = userEvent.setup();
    const onOpenInNewWindow = vi.fn();
    const onDelete = vi.fn(async () => true);
    renderDialog({ cloudProjects: {
      projects: [{ id: "prj_old", name: "旧书", lastActivityAt: null, archived: false, referenceId: "ws-old" }],
      onOpen: vi.fn(),
      onOpenInNewWindow,
      onDelete,
    } });
    await user.click(screen.getByRole("button", { name: /^旧书/ }));
    await user.click(screen.getByRole("button", { name: "在新窗口打开" }));
    expect(onOpenInNewWindow).toHaveBeenCalledWith({ id: "prj_old", name: "旧书" });

    await user.click(screen.getByRole("button", { name: "删除云端项目 旧书" }));
    expect(screen.getByText(/确定删除云端项目「旧书」/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除", exact: true }));
    expect(onDelete).toHaveBeenCalledWith("prj_old");
  });

  it("老 main（cloudProjects 缺省）：列表区升级提示；空列表空态", () => {
    renderDialog({ cloudProjects: undefined });
    expect(screen.getByText(/当前应用版本不支持云端项目/)).toBeInTheDocument();
  });
});
