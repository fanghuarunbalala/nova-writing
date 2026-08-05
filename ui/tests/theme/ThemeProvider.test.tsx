/**
 * ThemeProvider 组件测试：根属性同步、useTheme 访问与错误边界。
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../../src/shared/theme/ThemeProvider.js";

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      theme:{theme}
    </button>
  );
}

describe("ThemeProvider", () => {
  it("renders children and sets the html data-theme attribute", () => {
    render(
      <ThemeProvider initialTheme="light">
        <span>content</span>
      </ThemeProvider>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("exposes setTheme and syncs the root attribute", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    act(() => button.click());
    expect(button).toHaveTextContent("theme:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("throws when useTheme is used outside the provider", () => {
    expect(() => render(<ThemeProbe />)).toThrow("useTheme must be used within ThemeProvider");
  });
});
