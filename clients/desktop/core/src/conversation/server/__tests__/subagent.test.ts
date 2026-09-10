import { describe, it, expect, vi } from "vitest";
import { Subagent } from "../Subagent.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";

function mockLoop(): AgentLoop {
  return {
    run: async (input: string) => ({ final: { role: "assistant", content: `回复:${input}` }, usage: undefined }),
    cancel: vi.fn(),
  } as unknown as AgentLoop;
}

describe("Subagent", () => {
  it("send → result 返回最终结果", async () => {
    const sub = new Subagent({ loop: mockLoop(), sampling: { model: "gpt-5" } });
    await sub.send("调研世界观");
    expect(await sub.result()).toBe("回复:调研世界观");
  });

  it("stop 调 loop.cancel", async () => {
    const loop = mockLoop();
    const sub = new Subagent({ loop, sampling: { model: "gpt-5" } });
    await sub.stop();
    expect((loop.cancel as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
