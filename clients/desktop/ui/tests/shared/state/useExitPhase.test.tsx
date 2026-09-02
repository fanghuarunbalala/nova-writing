/**
 * useExitPhase 单测：退场相位（mounted/exiting）流转、退出中重开取消、卸载清定时器。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useExitPhase } from "../../../src/shared/state/useExitPhase.js";

describe("useExitPhase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays unmounted when initially closed (初始关闭不挂载)", () => {
    const { result } = renderHook(({ open }) => useExitPhase(open, 250), {
      initialProps: { open: false },
    });
    expect(result.current).toEqual({ mounted: false, exiting: false });
  });

  it("mounts on open (possibly in the same render before the effect)", () => {
    const { result, rerender } = renderHook(({ open }) => useExitPhase(open, 250), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, exiting: false });
  });

  it("enters exiting phase on close and unmounts after the duration", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => useExitPhase(open, 250), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    rerender({ open: false });
    // 关闭瞬间：退场相位（DOM 保留播动画）
    expect(result.current).toEqual({ mounted: true, exiting: true });
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toEqual({ mounted: true, exiting: true });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ mounted: false, exiting: false });
  });

  it("cancels a pending exit when reopened during the exiting phase (退出中重开)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => useExitPhase(open, 250), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    rerender({ open: false });
    expect(result.current.exiting).toBe(true);
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, exiting: false });
    // 旧退场定时器已清：推进时长后不卸载
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toEqual({ mounted: true, exiting: false });
  });

  it("clears the pending timer on unmount (退出中卸载不泄漏)", () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ open }) => useExitPhase(open, 250), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    rerender({ open: false });
    expect(result.current.exiting).toBe(true);
    expect(() => {
      unmount();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });
});
