/**
 * 设置「外观」分类端到端（组件级）：打开设置 → 切到外观 → 8 张主题卡 →
 * 点击卡片切换 <html data-theme> 并持久化 localStorage。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "../../src/shared/theme/ThemeProvider.js";
import { SettingsDialog } from "../../src/settings/SettingsDialog.js";
import { ApplicationSettingsStore } from "../../src/settings/ApplicationSettingsStore.js";

describe("AppearanceSettings", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.classList.remove("theming");
  });

  it("opens the appearance section, lists 4 themes and switches on click", () => {
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          store={new ApplicationSettingsStore()}
          onDismiss={() => {}}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /宣纸白/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: /黛青/ }));
    expect(document.documentElement.dataset.theme).toBe("celadon");
    expect(localStorage.getItem("novel.theme")).toBe("celadon");
    expect(screen.getByRole("radio", { name: /黛青/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /宣纸白/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
