/**
 * Tooltip 组件测试：hover 显示内容。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip } from "../../src/shared/primitives/Tooltip.js";

describe("Tooltip", () => {
  it("shows content on hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="新建对话" delay={0}>
        <button type="button">+</button>
      </Tooltip>,
    );
    expect(screen.queryByText("新建对话")).not.toBeInTheDocument();
    await user.hover(screen.getByRole("button"));
    expect(await screen.findByText("新建对话")).toBeInTheDocument();
  });
});
