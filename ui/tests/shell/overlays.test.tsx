/**
 * overlays 组件测试：toast 渲染、手动/自动关闭。
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlaysHost } from "../../src/shell/overlays/OverlaysHost.js";
import { ToastHost } from "../../src/shell/overlays/ToastHost.js";
import { ToastStore } from "../../src/shared/state/ToastStore.js";

describe("ToastHost", () => {
  it("renders toasts and dismisses on button click", async () => {
    const user = userEvent.setup();
    const store = new ToastStore();
    store.push({ kind: "success", text: "已批准" });
    render(<ToastHost store={store} />);
    expect(screen.getByText("已批准")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(screen.queryByText("已批准")).not.toBeInTheDocument();
  });

  it("auto-dismisses after 4 seconds", () => {
    vi.useFakeTimers();
    try {
      const store = new ToastStore();
      store.push({ kind: "warn", text: "即将过期" });
      render(<ToastHost store={store} />);
      expect(screen.getByText("即将过期")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4100);
      });
      expect(screen.queryByText("即将过期")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OverlaysHost", () => {
  it("renders children and toasts", () => {
    const store = new ToastStore();
    store.push({ kind: "info", text: "提示" });
    render(
      <OverlaysHost toastStore={store}>
        <div>弹窗槽位</div>
      </OverlaysHost>,
    );
    expect(screen.getByText("弹窗槽位")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
  });
});
