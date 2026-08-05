/**
 * 时间线窗口化纯函数测试。
 */
import { describe, expect, it } from "vitest";
import { computeTimelineWindow } from "../../../src/domains/conversation/components/timelineWindow.js";

describe("computeTimelineWindow", () => {
  it("windows around the first visible row with overscan", () => {
    const window = computeTimelineWindow({
      itemCount: 1000,
      scrollTop: 500,
      viewportHeight: 560,
      rowHeight: 56,
      overscan: 12,
    });
    // firstVisible = floor(500/56) = 8；visible = ceil(560/56) = 10
    expect(window).toEqual({ startIndex: 0, endIndex: 30 });
  });

  it("clamps to list bounds", () => {
    const top = computeTimelineWindow({
      itemCount: 10,
      scrollTop: 0,
      viewportHeight: 560,
      rowHeight: 56,
      overscan: 12,
    });
    expect(top).toEqual({ startIndex: 0, endIndex: 10 });
    const bottom = computeTimelineWindow({
      itemCount: 10,
      scrollTop: 100000,
      viewportHeight: 560,
      rowHeight: 56,
      overscan: 12,
    });
    expect(bottom.endIndex).toBe(10);
  });

  it("handles empty and degenerate inputs", () => {
    expect(
      computeTimelineWindow({ itemCount: 0, scrollTop: 0, viewportHeight: 100, rowHeight: 56, overscan: 4 }),
    ).toEqual({ startIndex: 0, endIndex: 0 });
    expect(
      computeTimelineWindow({ itemCount: 5, scrollTop: 0, viewportHeight: 0, rowHeight: 56, overscan: 4 }),
    ).toEqual({ startIndex: 0, endIndex: 5 });
  });
});
