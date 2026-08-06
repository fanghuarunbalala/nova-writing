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
    recent: [{ id: "ws-1", label: "白昼计划" }],
    ...overrides,
  });

  it("renders choose action and recent projects, opening a recent item on click", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onOpenRecent = vi.fn();
    render(
      <ProjectSelectionPage
        snapshot={snapshot()}
        onChoose={onChoose}
        onOpenRecent={onOpenRecent}
      />,
    );
    expect(screen.getByText("开始创作")).toBeInTheDocument();
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开项目文件夹…" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /白昼计划/ }));
    expect(onOpenRecent).toHaveBeenCalledWith("ws-1");
  });

  it("shows empty hint, error banner and busy states", () => {
    const { rerender } = render(
      <ProjectSelectionPage
        snapshot={snapshot({ recent: [] })}
        onChoose={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    );
    expect(screen.getByText("还没有打开过项目")).toBeInTheDocument();

    rerender(
      <ProjectSelectionPage
        snapshot={snapshot({
          phase: "opening",
          error: { code: "OPEN_FAILED", retryable: true, message: "打开失败" },
        })}
        onChoose={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    );
    expect(screen.getByText("正在打开…")).toBeInTheDocument();
    expect(screen.getByText("打开失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在打开…" })).toBeDisabled();
  });
});
