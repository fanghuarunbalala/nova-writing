/**
 * InspectorRouter 单元测试：transition/close/setMode。
 */
import { describe, expect, it } from "vitest";
import { InspectorRouter } from "../../src/shared/routing/InspectorRouter.js";

describe("InspectorRouter", () => {
  it("starts closed", () => {
    const router = new InspectorRouter();
    expect(router.getSnapshot()).toEqual({ state: { kind: "closed" }, mode: "closed" });
  });

  it("transition opens a panel with a mode", () => {
    const router = new InspectorRouter();
    router.transition({ kind: "conversation", conversationId: "c1" });
    expect(router.getSnapshot()).toEqual({
      state: { kind: "conversation", conversationId: "c1" },
      mode: "normal",
    });
  });

  it("close resets state and mode", () => {
    const router = new InspectorRouter();
    router.transition({ kind: "outlineUnit", unitId: "u1" }, "wide");
    router.close();
    expect(router.getSnapshot()).toEqual({ state: { kind: "closed" }, mode: "closed" });
  });

  it("setMode ignores non-closed modes while closed and works when open", () => {
    const router = new InspectorRouter();
    router.setMode("wide");
    expect(router.getSnapshot().mode).toBe("closed");
    router.transition({ kind: "conversation", conversationId: "c1" });
    router.setMode("wide");
    expect(router.getSnapshot().mode).toBe("wide");
  });
});
