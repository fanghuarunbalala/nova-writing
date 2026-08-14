import { describe, it, expect, vi } from "vitest";
import { ComposeModeNudgePolicy } from "../compose.js";
import { ComposeModeStateProvider } from "../../../../conversation/compose/ComposeModeState.js";
import type { LoopContext } from "../../../loop/LoopContext.js";
import type { RunContext } from "../../../loop/types.js";

function mockLoop() {
  return { appendRunMessages: vi.fn() } as unknown as LoopContext;
}
const run: RunContext = { curTurn: 0, maxTurn: 100, toolsLastTurn: new Map() };

describe("ComposeModeNudgePolicy", () => {
  it("false→true 进入 compose → 发 compose_mode", () => {
    const state = new ComposeModeStateProvider();
    const policy = new ComposeModeNudgePolicy(state, "main");
    state.enter("main", { designFilePath: "/d.md", preComposeMode: "review" });
    const loop = mockLoop();
    expect(policy.persistentNudgeIfNeeded(loop, run)).toBe(true);
    const msg = (loop.appendRunMessages as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(msg.content).toContain("设计模式");
  });

  it("true→false 退出 compose → 发 compose_mode_exit", () => {
    const state = new ComposeModeStateProvider();
    const policy = new ComposeModeNudgePolicy(state, "main");
    state.enter("main", { designFilePath: "/d.md" });
    policy.persistentNudgeIfNeeded(mockLoop(), run); // 进入，latch=true
    state.discard("main");
    const loop = mockLoop();
    expect(policy.persistentNudgeIfNeeded(loop, run)).toBe(true);
    const msg = (loop.appendRunMessages as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(msg.content).toContain("设计模式已结束");
  });

  it("无 transition 不注入", () => {
    const state = new ComposeModeStateProvider();
    const policy = new ComposeModeNudgePolicy(state, "main");
    const loop = mockLoop();
    expect(policy.persistentNudgeIfNeeded(loop, run)).toBe(false);
    expect(loop.appendRunMessages).not.toHaveBeenCalled();
  });
});
