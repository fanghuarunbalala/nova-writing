/**
 * Button 组件测试：渲染、变体类名、loading/disabled、点击。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../../src/shared/primitives/Button.js";

describe("Button", () => {
  it("renders children and defaults to secondary/md", () => {
    render(<Button>发送</Button>);
    const button = screen.getByRole("button", { name: "发送" });
    expect(button).toHaveClass("button", "secondary", "sizeMd");
  });

  it("applies variant and size classes", () => {
    render(
      <Button variant="primary" size="lg">
        批准
      </Button>,
    );
    expect(screen.getByRole("button")).toHaveClass("primary", "sizeLg");
  });

  it("disables while loading and sets aria-busy", () => {
    render(<Button loading>保存</Button>);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveClass("loading");
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("fires onClick and respects disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>点我</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        点我
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
