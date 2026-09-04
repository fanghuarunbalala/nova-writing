/**
 * ConversationTimeline 分段加载交互（纯云端化 ⑤）：
 * 滚动到顶部（jsdom 缺省 scrollTop=0 < 96 阈值）触发 onRequestOlder；
 * loadingOlder 在途不重入；指示条显隐。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConversationTimeline } from "../../../src/domains/conversation/components/ConversationTimeline.js";

const items = [
  { kind: "user", sequence: 1, text: "你好呀", timestamp: 0 },
  { kind: "assistant", sequence: 2, text: "在的", timestamp: 0 },
] as never;

function timelineRoot(): HTMLElement {
  return screen.getByRole("log");
}

describe("ConversationTimeline 分段加载", () => {
  it("滚动事件触发 onRequestOlder（顶部阈值）；loadingOlder 在途不重入；指示条随 loadingOlder 显隐", () => {
    const onRequestOlder = vi.fn(() => new Promise<boolean>(() => {}));
    const { rerender } = render(
      <ConversationTimeline
        conversationId="c1"
        items={items}
        canLoadOlder
        loadingOlder={false}
        onRequestOlder={onRequestOlder}
      />,
    );
    // loadingOlder=false 时不显示指示条
    expect(screen.queryByText("正在加载更早的消息…")).toBeNull();
    fireEvent.scroll(timelineRoot());
    expect(onRequestOlder).toHaveBeenCalledTimes(1);
    // 在途（Promise 未决）：再次滚动不重入
    fireEvent.scroll(timelineRoot());
    fireEvent.scroll(timelineRoot());
    expect(onRequestOlder).toHaveBeenCalledTimes(1);

    // loadingOlder=true → 指示条出现；期间滚动仍不触发
    rerender(
      <ConversationTimeline
        conversationId="c1"
        items={items}
        canLoadOlder
        loadingOlder
        onRequestOlder={onRequestOlder}
      />,
    );
    expect(screen.getByText("正在加载更早的消息…")).toBeInTheDocument();
    fireEvent.scroll(timelineRoot());
    expect(onRequestOlder).toHaveBeenCalledTimes(1);
  });

  it("canLoadOlder=false（翻尽/短会话）不触发回调", () => {
    const onRequestOlder = vi.fn();
    render(
      <ConversationTimeline
        conversationId="c1"
        items={items}
        canLoadOlder={false}
        onRequestOlder={onRequestOlder}
      />,
    );
    fireEvent.scroll(timelineRoot());
    expect(onRequestOlder).not.toHaveBeenCalled();
  });
});
