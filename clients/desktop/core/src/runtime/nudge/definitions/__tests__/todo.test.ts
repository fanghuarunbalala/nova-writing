import { describe, it, expect, vi } from "vitest";
import { TodoIdleNudgePolicy, TODO_IDLE_MARK } from "../todo.js";
import type { LoopContext } from "../../../loop/LoopContext.js";
import type { RunContext } from "../../../loop/types.js";

function mockLoop() {
  return {
    appendRunMessages: vi.fn(),
  } as unknown as LoopContext;
}

function run(curTurn: number, todoWriteTurn?: number): RunContext {
  const toolsLastTurn = new Map<string, number>();
  if (todoWriteTurn !== undefined) toolsLastTurn.set("TodoWrite", todoWriteTurn);
  return { curTurn, maxTurn: 100, toolsLastTurn };
}

describe("TodoIdleNudgePolicy", () => {
  it("连续 ≥3 轮未写 TodoWrite → 注入 reminder", () => {
    const policy = new TodoIdleNudgePolicy();
    const loop = mockLoop();
    const injected = policy.persistentNudgeIfNeeded(loop, run(5, 1));
    expect(injected).toBe(true);
    expect(loop.appendRunMessages).toHaveBeenCalledOnce();
    const msg = (loop.appendRunMessages as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(msg.content).toContain(TODO_IDLE_MARK);
  });

  it("近期写过 TodoWrite → 不注入", () => {
    const policy = new TodoIdleNudgePolicy();
    const loop = mockLoop();
    expect(policy.persistentNudgeIfNeeded(loop, run(3, 2))).toBe(false);
    expect(loop.appendRunMessages).not.toHaveBeenCalled();
  });

  it("同 run 只注入一次", () => {
    const policy = new TodoIdleNudgePolicy();
    const loop = mockLoop();
    policy.persistentNudgeIfNeeded(loop, run(5));
    policy.persistentNudgeIfNeeded(loop, run(5));
    expect(loop.appendRunMessages).toHaveBeenCalledOnce();
  });
});
