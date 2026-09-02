/**
 * MainViewHistory 单元测试：双栈 push/back/forward。
 */
import { describe, expect, it } from "vitest";
import { MainViewHistory } from "../../src/shared/routing/MainViewHistory.js";

describe("MainViewHistory", () => {
  it("tracks back/forward stacks across navigation", () => {
    const history = new MainViewHistory<string>();
    history.push("chat");
    expect(history.canBack).toBe(true);
    expect(history.back("content")).toBe("chat");
    expect(history.canForward).toBe(true);
    expect(history.forward("chat")).toBe("content");
    expect(history.canForward).toBe(false);
  });

  it("clears forward stack on a new push", () => {
    const history = new MainViewHistory<string>();
    history.push("chat");
    history.back("content");
    expect(history.canForward).toBe(true);
    history.push("content");
    expect(history.canForward).toBe(false);
  });

  it("returns undefined when no history exists", () => {
    const history = new MainViewHistory<string>();
    expect(history.back("chat")).toBeUndefined();
    expect(history.forward("chat")).toBeUndefined();
  });
});
