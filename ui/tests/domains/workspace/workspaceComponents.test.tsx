/**
 * workspace 域组件渲染测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
