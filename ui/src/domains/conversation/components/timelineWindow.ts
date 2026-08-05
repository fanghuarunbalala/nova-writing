/**
 * timelineWindow
 *
 * 消息时间线固定行高窗口化计算（纯函数）。行高取近似值，
 * 虚拟化仅用于消息量大的对话，降低 DOM 节点数。
 */
export interface TimelineWindow {
  readonly startIndex: number;
  readonly endIndex: number; // exclusive
}

export interface ComputeTimelineWindowOptions {
  readonly itemCount: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly overscan: number;
}

export function computeTimelineWindow(
  options: ComputeTimelineWindowOptions,
): TimelineWindow {
  const { itemCount, scrollTop, viewportHeight, rowHeight, overscan } = options;
  if (itemCount <= 0) return { startIndex: 0, endIndex: 0 };
  if (viewportHeight <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: itemCount };
  }
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight));
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  return {
    startIndex: Math.max(0, firstVisible - overscan),
    endIndex: Math.min(itemCount, firstVisible + visibleCount + overscan),
  };
}
