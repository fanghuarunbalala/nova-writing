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

describe("ProjectSelectionPage", () => {
  const snapshot = (overrides = {}) => ({
    revision: 1,
    phase: "idle",
    recent: [
      {
        id: "ws-1",
        label: "白昼计划",
        lastOpenedAt: new Date().toISOString(),
        rootPath: "D:\\books\\白昼计划",
      },
    ],
    ...overrides,
  });

  it("renders welcome brand, dual actions and recent cards, wiring callbacks", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onCreate = vi.fn();
    const onOpenRecent = vi.fn();
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        onChoose={onChoose}
        onCreate={onCreate}
        onOpenRecent={onOpenRecent}
        onDeleteRecent={vi.fn(async () => true)}
      />,
    );
    // 品牌区 + 节标题（demo 欢迎页结构）
    expect(screen.getByText("Novel")).toBeInTheDocument();
    expect(screen.getByText("把一桩旧事，写成一本新书。")).toBeInTheDocument();
    expect(screen.getByText("最近的项目")).toBeInTheDocument();
    // 卡片：书名 + 副标题（相对时间 · 路径）
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByText(/D:\\books\\白昼计划/)).toBeInTheDocument();
    // 新建（save 型命名建目录）与打开（目录选择器）分开接线
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "打开其他项目…" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    // 卡片主体按钮名以书名开头（右上角删除钮 aria-label 为「删除项目 白昼计划」，^ 区分）
    await user.click(screen.getByRole("button", { name: /^白昼计划/ }));
    expect(onOpenRecent).toHaveBeenCalledWith("ws-1");
  });

  it("shows empty hint, error banner and busy states", () => {
    const { rerender } = render(
      <ProjectSelectionPage
        snapshot={snapshot({ recent: [] })}
        onChoose={vi.fn()}
        onCreate={vi.fn()}
        onOpenRecent={vi.fn()}
        onDeleteRecent={vi.fn(async () => true)}
      />,
    );
    expect(screen.getByText(/还没有打开过项目/)).toBeInTheDocument();

    rerender(
      <ProjectSelectionPage
        snapshot={snapshot({
          phase: "opening",
          error: { code: "OPEN_FAILED", retryable: true, message: "打开失败" },
        })}
        onChoose={vi.fn()}
        onCreate={vi.fn()}
        onOpenRecent={vi.fn()}
        onDeleteRecent={vi.fn(async () => true)}
      />,
    );
    expect(screen.getByText("打开失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开其他项目…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^白昼计划/ })).toBeDisabled();
  });

  it("confirms deletion via danger dialog before calling onDeleteRecent", async () => {
    const user = userEvent.setup();
    const onDeleteRecent = vi.fn(async () => true);
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        onChoose={vi.fn()}
        onCreate={vi.fn()}
        onOpenRecent={vi.fn()}
        onDeleteRecent={onDeleteRecent}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除项目 白昼计划" }));
    // danger 确认弹窗：明示不可恢复 + 整个文件夹强删 + 完整路径核对
    expect(screen.getByText(/不可恢复/)).toBeInTheDocument();
    expect(screen.getByText(/整个项目文件夹（含其中的全部文件）/)).toBeInTheDocument();
    expect(screen.getByText(/项目文件夹：D:\\books\\白昼计划/)).toBeInTheDocument();
    expect(onDeleteRecent).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteRecent).toHaveBeenCalledWith("ws-1");
  });
});

describe("WorkspaceSelectionDialog（删除项目）", () => {
  const snapshot = (overrides = {}) => ({
    revision: 1,
    phase: "ready",
    current: { id: "ws-cur", label: "当前书" },
    recent: [
      { id: "ws-cur", label: "当前书" },
      { id: "ws-old", label: "旧书" },
    ],
    ...overrides,
  });

  function renderDialog(onDeleteRecent: (workspaceId: string) => Promise<boolean>) {
    render(
      <WorkspaceSelectionDialog
        open
        snapshot={snapshot()}
        onPick={vi.fn(async () => undefined)}
        onOpen={vi.fn()}
        onOpenInNewWindow={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onDeleteRecent={onDeleteRecent}
        onDismiss={vi.fn()}
      />,
    );
  }

  it("filters the current workspace out (running protection) and offers deletion on the rest", () => {
    renderDialog(vi.fn(async () => true));

    // 当前项目不进切换列表（运行中保护从源头过滤），自然无其删除入口
    expect(screen.queryByRole("button", { name: "删除项目 当前书" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除项目 旧书" })).toBeEnabled();
  });

  it("confirms deletion for a non-current workspace and wires onDeleteRecent", async () => {
    const user = userEvent.setup();
    const onDeleteRecent = vi.fn(async () => true);
    renderDialog(onDeleteRecent);

    await user.click(screen.getByRole("button", { name: "删除项目 旧书" }));
    expect(screen.getByText(/确定删除项目「旧书」/)).toBeInTheDocument();
    expect(screen.getByText(/整个项目文件夹（含其中的全部文件）/)).toBeInTheDocument();
    expect(onDeleteRecent).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onDeleteRecent).toHaveBeenCalledWith("ws-old");
  });
});

describe("WorkspaceSelectionDialog（打开位置选择）", () => {
  const dialogSnapshot = (overrides = {}) => ({
    revision: 1,
    phase: "ready",
    current: { id: "ws-1", label: "在写" },
    recent: [
      {
        id: "ws-2",
        label: "第二本",
        lastOpenedAt: new Date().toISOString(),
        rootPath: "D:\\books\\第二本",
      },
    ],
    ...overrides,
  });

  const renderDialog = (overrides: Partial<Parameters<typeof WorkspaceSelectionDialog>[0]> = {}) =>
    render(
      <WorkspaceSelectionDialog
        open
        snapshot={dialogSnapshot()}
        onPick={vi.fn(async () => undefined)}
        onOpen={vi.fn()}
        onOpenInNewWindow={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onDismiss={vi.fn()}
        {...overrides}
      />,
    );

  it("选定目录后出现打开位置面板：新窗口派发、当前窗口不动、面板收起", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn(async () => ({ referenceId: "D:\\books\\第三本", label: "第三本" }));
    const onOpen = vi.fn();
    const onOpenInNewWindow = vi.fn();
    renderDialog({ onPick, onOpen, onOpenInNewWindow });

    await user.click(screen.getByRole("button", { name: "打开项目文件夹…" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/打开《第三本》/)).toBeInTheDocument();
    expect(
      screen.getByText(/当前窗口打开会结束本项目全部运行中的对话/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "在新窗口打开" }));
    expect(onOpenInNewWindow).toHaveBeenCalledWith({
      referenceId: "D:\\books\\第三本",
      label: "第三本",
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText(/打开《第三本》/)).not.toBeInTheDocument();
  });

  it("最近项点击进入面板；在当前窗口打开触发 onOpen；取消清面板不回调", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onOpenInNewWindow = vi.fn();
    renderDialog({ onOpen, onOpenInNewWindow });

    // 列表项按钮名以书名开头（删除钮 aria-label 为「删除项目 第二本」，^ 区分）
    await user.click(screen.getByRole("button", { name: /^第二本/ }));
    expect(screen.getByText(/打开《第二本》/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "在当前窗口打开" }));
    expect(onOpen).toHaveBeenCalledWith({ referenceId: "ws-2", label: "第二本" });
    expect(onOpenInNewWindow).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^第二本/ }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText(/打开《第二本》/)).not.toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpenInNewWindow).not.toHaveBeenCalled();
  });

  it("最近列表默认过滤当前项目（id 与 rootPath 双匹配），过滤后空态提示其他文案", () => {
    renderDialog({
      snapshot: dialogSnapshot({
        current: { id: "ws-2", label: "第二本", rootPath: "D:\\books\\第二本" },
      }),
    });
    // recent 仅第二本（= 当前项目）→ 列表不显示，空态文案区分"无其他可切换"
    expect(screen.queryByRole("button", { name: /第二本/ })).not.toBeInTheDocument();
    expect(screen.getByText("没有其他可切换的项目")).toBeInTheDocument();
  });
});
