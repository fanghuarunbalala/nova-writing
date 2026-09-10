/**
 * Spinner / Badge / Pill / Avatar / Kbd / Text / Separator 渲染测试。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../../src/shared/primitives/Avatar.js";
import { Badge } from "../../src/shared/primitives/Badge.js";
import { Kbd } from "../../src/shared/primitives/Kbd.js";
import { Pill } from "../../src/shared/primitives/Pill.js";
import { Separator } from "../../src/shared/primitives/Separator.js";
import { Spinner } from "../../src/shared/primitives/Spinner.js";
import { Text } from "../../src/shared/primitives/Text.js";

describe("Spinner", () => {
  it("renders a progressbar with size and variant classes", () => {
    render(<Spinner size="sm" variant="danger" />);
    const spinner = screen.getByRole("progressbar");
    expect(spinner).toHaveClass("spinner", "sm", "danger");
  });
});

describe("Badge", () => {
  it("renders count and max+ formatting", () => {
    const { rerender } = render(<Badge count={5} />);
    expect(screen.getByLabelText("5 项")).toHaveTextContent("5");
    rerender(<Badge count={150} max={99} />);
    expect(screen.getByLabelText("150 项")).toHaveTextContent("99+");
  });
});

describe("Pill", () => {
  it("renders children with variant class", () => {
    render(<Pill variant="pending">待审</Pill>);
    expect(screen.getByText("待审")).toHaveClass("pill", "pending");
  });
});

describe("Avatar", () => {
  it("renders the first two characters", () => {
    render(<Avatar variant="agent" text="智脑" />);
    expect(screen.getByText("智脑")).toHaveClass("avatar", "agent", "md");
  });
});

describe("Kbd", () => {
  it("renders keyboard hint", () => {
    render(<Kbd>Ctrl+K</Kbd>);
    expect(screen.getByText("Ctrl+K")).toHaveClass("kbd");
  });
});

describe("Text", () => {
  it("renders as the requested element with token classes", () => {
    const { rerender } = render(
      <Text as="p" size="lg" weight="bold" color="muted">
        标题
      </Text>,
    );
    const p = screen.getByText("标题");
    expect(p.tagName).toBe("P");
    expect(p).toHaveClass("lg", "bold", "muted");
    rerender(
      <Text mono color="accent">
        代码
      </Text>,
    );
    expect(screen.getByText("代码")).toHaveClass("mono", "accent");
  });
});

describe("Separator", () => {
  it("renders a separator with orientation and variant classes", () => {
    render(<Separator orientation="vertical" variant="strong" />);
    expect(screen.getByRole("separator")).toHaveClass("separator", "vertical", "strong");
  });
});
