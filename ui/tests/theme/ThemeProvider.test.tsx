/**
 * ThemeProvider 组件测试：根属性同步、useTheme 访问、localStorage 持久化与错误边界。
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  DEFAULT_THEME,
  ThemeProvider,
  THEMES,
  useTheme,
} from "../../src/shared/theme/ThemeProvider.js";

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("ink")}>
      theme:{theme}
    </button>
  );
}

describe("ThemeProvider", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.classList.remove("theming");
  });

  it("renders children and sets the html data-theme attribute", () => {
    render(
      <ThemeProvider initialTheme="paper">
        <span>content</span>
      </ThemeProvider>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("paper");
  });

  it("exposes setTheme, syncs the root attribute and persists to localStorage", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent(`theme:${DEFAULT_THEME}`);
    act(() => button.click());
    expect(button).toHaveTextContent("theme:ink");
    expect(document.documentElement.dataset.theme).toBe("ink");
    expect(localStorage.getItem("novel.theme")).toBe("ink");
    // 切换窗口：html 挂 theming 过渡类
    expect(document.documentElement.classList.contains("theming")).toBe(true);
  });

  it("restores the persisted theme on mount without initialTheme", () => {
    localStorage.setItem("novel.theme", "gilt");
    render(
      <ThemeProvider>
        <span>content</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("gilt");
  });

  it("falls back to the default theme for invalid stored values", () => {
    localStorage.setItem("novel.theme", "sepia");
    render(
      <ThemeProvider>
        <span>content</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });

  it("throws when useTheme is used outside the provider", () => {
    expect(() => render(<ThemeProbe />)).toThrow("useTheme must be used within ThemeProvider");
  });

  it("ships exactly the eight themes with paper as default", () => {
    expect([...THEMES]).toEqual([
      "paper", "ink", "celadon", "frost", "bamboo", "gilt", "rouge", "zitan",
    ]);
    expect(DEFAULT_THEME).toBe("paper");
  });
});
