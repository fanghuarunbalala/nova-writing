/**
 * Dialog 组件测试：打开渲染、遮罩点击关闭、ESC 关闭、footer。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../../src/shared/primitives/Dialog.js";

function Harness({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="设置"
      description="修改偏好"
      footer={<button type="button">保存</button>}
    >
      内容区
    </Dialog>
  );
}

describe("Dialog", () => {
  it("renders title, description, body and footer when open", () => {
    render(<Harness open onOpenChange={vi.fn()} />);
    expect(screen.getByText("设置")).toBeInTheDocument();
    expect(screen.getByText("修改偏好")).toBeInTheDocument();
    expect(screen.getByText("内容区")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("closes on overlay click", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness open onOpenChange={onOpenChange} />);
    const overlay = document.querySelector(".overlay");
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness open onOpenChange={onOpenChange} />);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not render content when closed", () => {
    render(<Harness open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("内容区")).not.toBeInTheDocument();
  });
});
