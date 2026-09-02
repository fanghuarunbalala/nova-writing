/**
 * ComposerModeBar 退场单测：手写菜单无 radix Presence 兜底——关闭先播
 * menu-out（optionsClosing）再卸载；退出中重开取消退场。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ComposerModeBar } from "../../../../src/domains/conversation/components/ComposerModeBar.js";

describe("ComposerModeBar exit phase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the options mounted with the closing class, then unmounts", () => {
    vi.useFakeTimers();
    render(<ComposerModeBar mode="review" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /执行模式/ });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "执行模式" })).toBeInTheDocument();

    // 关闭：退场相位（DOM 保留 + closing 类），不瞬时消失
    fireEvent.click(trigger);
    const closing = screen.getByRole("menu", { name: "执行模式" });
    expect(closing.className).toContain("optionsClosing");

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.getByRole("menu", { name: "执行模式" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("menu", { name: "执行模式" })).not.toBeInTheDocument();
  });

  it("cancels the exit when reopened while closing (退出中重开)", () => {
    vi.useFakeTimers();
    render(<ComposerModeBar mode="review" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /执行模式/ });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "执行模式" }).className).toContain("optionsClosing");

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "执行模式" });
    expect(menu.className).not.toContain("optionsClosing");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("menu", { name: "执行模式" })).toBeInTheDocument();
  });

  it("selecting an option closes through the same exit phase (选中即收起走退场)", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<ComposerModeBar mode="review" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /执行模式/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /直接执行/ }));
    expect(onChange).toHaveBeenCalledWith("bypass");
    expect(screen.getByRole("menu", { name: "执行模式" }).className).toContain("optionsClosing");
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole("menu", { name: "执行模式" })).not.toBeInTheDocument();
  });
});
