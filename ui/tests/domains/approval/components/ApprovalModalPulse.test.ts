/**
 * ApprovalModal 决策脉冲 diff 纯函数单测：
 * 首帧全不脉冲（弹窗打开不整列闪）、pending→已决脉冲、新增组脉冲（非首帧）。
 */
import { describe, expect, it } from "vitest";
import { diffPulseKeys } from "../../../../src/domains/approval/components/ApprovalModal.js";

const prev = (entries: readonly (readonly [string, string])[]) => new Map(entries);

describe("diffPulseKeys", () => {
  it("pulses nothing on the first frame (prev empty → 打开弹窗不整列闪)", () => {
    const keys = diffPulseKeys(
      [
        { key: "a:1", status: "pending" },
        { key: "a:2", status: "pending" },
      ],
      prev([]),
    );
    expect(keys.size).toBe(0);
  });

  it("pulses groups that just transitioned out of pending (决策反馈)", () => {
    const keys = diffPulseKeys(
      [
        { key: "a:1", status: "approved" },
        { key: "a:2", status: "rejected" },
        { key: "a:3", status: "pending" },
      ],
      prev([
        ["a:1", "pending"],
        ["a:2", "pending"],
        ["a:3", "pending"],
      ]),
    );
    expect([...keys].sort()).toEqual(["a:1", "a:2"]);
  });

  it("does not pulse unchanged statuses (含已决组之间的重排/引用刷新)", () => {
    const keys = diffPulseKeys(
      [
        { key: "a:1", status: "approved" },
        { key: "a:2", status: "pending" },
      ],
      prev([
        ["a:1", "approved"],
        ["a:2", "pending"],
      ]),
    );
    expect(keys.size).toBe(0);
  });

  it("pulses newly arrived groups once the modal has a previous frame (新增组入场)", () => {
    const keys = diffPulseKeys(
      [
        { key: "a:9", status: "pending" },
        { key: "a:1", status: "pending" },
      ],
      prev([["a:1", "pending"]]),
    );
    expect([...keys]).toEqual(["a:9"]);
  });
});
