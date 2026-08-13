/**
 * DragHandle 组件测试：delta 上报、rAF 节流、clamp、resizeEnd。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { DragHandle } from "../../src/shared/primitives/DragHandle.js";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function drag(handle: Element, startX: number, endX: number) {
  fireEvent.pointerDown(handle, { button: 0, clientX: startX, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: endX, clientY: 0 });
  await nextFrame();
  fireEvent.pointerUp(window);
}

describe("DragHandle", () => {
  it("reports horizontal deltas via rAF and ends the session", async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const { container } = render(
      <DragHandle orientation="horizontal" onResize={onResize} onResizeEnd={onResizeEnd} ariaLabel="调整宽度" />,
    );
    const handle = container.querySelector('[role="separator"]') as Element;
    await drag(handle, 100, 140);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(40);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it("uses clientY for vertical orientation", async () => {
    const onResize = vi.fn();
    const { container } = render(
      <DragHandle orientation="vertical" onResize={onResize} ariaLabel="调整高度" />,
    );
    const handle = container.querySelector('[role="separator"]') as Element;
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 70 });
    await nextFrame();
    fireEvent.pointerUp(window);
    expect(onResize).toHaveBeenCalledWith(20);
  });

  it("clamps the session delta to [min, max]", async () => {
    // max 侧：+300 raw -> 累计 clamp 到 +30
    const onResizeMax = vi.fn();
    const first = render(
      <DragHandle orientation="horizontal" min={-10} max={30} onResize={onResizeMax} ariaLabel="调整宽度" />,
    );
    const handle = first.container.querySelector('[role="separator"]') as Element;
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 0 });
    await nextFrame();
    fireEvent.pointerUp(window);
    expect(onResizeMax.mock.calls.flat().reduce((a, b) => a + b, 0)).toBe(30);

    // min 侧：-100 raw -> 累计 clamp 到 -10
    const onResizeMin = vi.fn();
    const second = render(
      <DragHandle orientation="horizontal" min={-10} max={30} onResize={onResizeMin} ariaLabel="调整宽度" />,
    );
    const handle2 = second.container.querySelector('[role="separator"]') as Element;
    fireEvent.pointerDown(handle2, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 0 });
    await nextFrame();
    fireEvent.pointerUp(window);
    expect(onResizeMin.mock.calls.flat().reduce((a, b) => a + b, 0)).toBe(-10);
  });

  it("sets aria-orientation and dragging state", () => {
    const { container } = render(
      <DragHandle orientation="horizontal" onResize={vi.fn()} ariaLabel="调整宽度" />,
    );
    const handle = container.querySelector('[role="separator"]') as Element;
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    expect(handle).not.toHaveAttribute("data-dragging");
  });
});
