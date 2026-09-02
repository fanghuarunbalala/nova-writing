/**
 * MainViewRouter 单元测试：状态机切换与 back/forward。
 */
import { describe, expect, it } from "vitest";
import { MainViewRouter } from "../../src/shared/routing/MainViewRouter.js";

describe("MainViewRouter", () => {
  it("starts at chat with no navigation history", () => {
    const router = new MainViewRouter();
    expect(router.getSnapshot()).toEqual({ state: "chat", canBack: false, canForward: false });
  });

  it("transition records back history and clears forward", () => {
    const router = new MainViewRouter();
    router.transition("content");
    router.transition("schedule");
    expect(router.getSnapshot().state).toBe("schedule");
    expect(router.getSnapshot().canBack).toBe(true);
    expect(router.getSnapshot().canForward).toBe(false);
  });

  it("transition to the same state is a no-op", () => {
    const router = new MainViewRouter();
    router.transition("chat");
    expect(router.getSnapshot().canBack).toBe(false);
  });

  it("back and forward move through the double stack", () => {
    const router = new MainViewRouter();
    router.transition("content");
    router.transition("schedule");
    router.back();
    expect(router.getSnapshot()).toEqual({ state: "content", canBack: true, canForward: true });
    router.back();
    expect(router.getSnapshot()).toEqual({ state: "chat", canBack: false, canForward: true });
    router.back();
    expect(router.getSnapshot().state).toBe("chat");
    router.forward();
    expect(router.getSnapshot().state).toBe("content");
    router.forward();
    expect(router.getSnapshot().state).toBe("schedule");
    router.forward();
    expect(router.getSnapshot().state).toBe("schedule");
  });
});
