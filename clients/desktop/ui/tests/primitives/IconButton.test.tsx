/**
 * IconButton 组件测试：aria-label、尺寸类名、点击。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IconButton } from "../../src/shared/primitives/IconButton.js";

describe("IconButton", () => {
  it("requires and applies an aria-label", () => {
    render(<IconButton label="删除">×</IconButton>);
    const button = screen.getByRole("button", { name: "删除" });
    expect(button).toHaveClass("iconButton", "md");
  });

  it("fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton label="设置" size="sm" onClick={onClick}>
        ⚙
      </IconButton>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveClass("sm");
  });
});
