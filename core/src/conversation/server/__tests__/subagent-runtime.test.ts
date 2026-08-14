import { describe, it, expect, vi } from "vitest";
import { SubagentRuntime } from "../SubagentRuntime.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { AgentLoopResult } from "../../../runtime/loop/types.js";
import type { OutputEvent } from "../../contract/events/index.js";

/** 可控 fake loop：run/cancel/onOutputEvent 均可编程 */
function fakeLoop(runImpl?: (input: string) => Promise<AgentLoopResult>) {
  const listeners = new Set<(e: OutputEvent) => void>();
  return {
    run: vi.fn(
      runImpl ??
        (async () => ({ final: { role: "assistant", content: "done" }, usage: undefined }) as AgentLoopResult),
    ),
    cancel: vi.fn(),
    onOutputEvent: vi.fn((l: (e: OutputEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    emit: (e: OutputEvent) => {
      for (const l of listeners) l(e);
    },
  };
}

function runtimeWith(loop: ReturnType<typeof fakeLoop>): { rt: SubagentRuntime; loop: ReturnType<typeof fakeLoop> } {
  const rt = new SubagentRuntime({
    sampling: { model: "deepseek-v4-flash" },
    builders: { novel_explorer: () => loop as unknown as AgentLoop },
  });
  return { rt, loop };
}

describe("SubagentRuntime", () => {
  it("spawn 返回 running acceptance 且 taskId 递增唯一", async () => {
    const { rt } = runtimeWith(fakeLoop());
    const a1 = rt.spawn({ agentType: "novel_explorer", prompt: "p1" });
    const a2 = rt.spawn({ agentType: "novel_explorer", prompt: "p2" });
    expect(a1).toEqual({ taskId: "task_1", status: "running" });
    expect(a2).toEqual({ taskId: "task_2", status: "running" });
    expect(a1.taskId).not.toBe(a2.taskId);
  });

  it("spawn 未知 agentType 抛错", () => {
    const { rt } = runtimeWith(fakeLoop());
    expect(() => rt.spawn({ agentType: "nope", prompt: "p" })).toThrow("未知 agent 类型: nope");
  });

  it("任务完成 → completed + result（agentId = agentType:taskId）", async () => {
    const { rt, loop } = runtimeWith(fakeLoop());
    const { taskId } = rt.spawn({ agentType: "novel_explorer", prompt: "查角色" });
    expect(loop.onOutputEvent).toHaveBeenCalled();
    await vi.waitFor(async () => {
      const [snap] = await rt.queryTasks([taskId]);
      expect(snap?.status).toBe("completed");
      expect(snap?.result).toBe("done");
      expect(snap?.agentType).toBe("novel_explorer");
    });
  });

  it("run 拒绝 → failed + error", async () => {
    const { rt } = runtimeWith(fakeLoop(async () => {
      throw new Error("provider 挂了");
    }));
    const { taskId } = rt.spawn({ agentType: "novel_explorer", prompt: "查角色" });
    await vi.waitFor(async () => {
      const [snap] = await rt.queryTasks([taskId]);
      expect(snap?.status).toBe("failed");
      expect(snap?.error).toBe("provider 挂了");
    });
  });

  it("stopTask 三态：not_found / already_terminal / cancellation_requested", async () => {
    const { rt } = runtimeWith(fakeLoop());
    expect(await rt.stopTask("task_99")).toBe("not_found");

    const { taskId } = rt.spawn({ agentType: "novel_explorer", prompt: "p" });
    await vi.waitFor(async () => {
      expect((await rt.queryTasks([taskId]))[0]?.status).toBe("completed");
    });
    expect(await rt.stopTask(taskId)).toBe("already_terminal");

    const { taskId: tid2 } = rt.spawn({ agentType: "novel_explorer", prompt: "p2" });
    expect(await rt.stopTask(tid2)).toBe("cancellation_requested");
  });

  it("晚 settle 不覆盖 cancelled（stop 后 run 完成也不写 completed）", async () => {
    let resolveRun!: (r: AgentLoopResult) => void;
    const { rt, loop } = runtimeWith(fakeLoop(() => new Promise((resolve) => (resolveRun = resolve))));
    const { taskId } = rt.spawn({ agentType: "novel_explorer", prompt: "p" });
    await vi.waitFor(() => expect(loop.run).toHaveBeenCalled());
    expect(await rt.stopTask(taskId)).toBe("cancellation_requested");
    expect(loop.cancel).toHaveBeenCalled();
    resolveRun({ final: { role: "assistant", content: "late" }, usage: undefined });
    await vi.waitFor(async () => {
      const [snap] = await rt.queryTasks([taskId]);
      expect(snap?.status).toBe("cancelled");
      expect(snap?.result).toBeUndefined();
    });
  });

  it("stopAll 取消全部 running 任务", async () => {
    const { rt, loop } = runtimeWith(fakeLoop());
    rt.spawn({ agentType: "novel_explorer", prompt: "p1" });
    rt.spawn({ agentType: "novel_explorer", prompt: "p2" });
    rt.stopAll();
    const snaps = await rt.queryTasks(["task_1", "task_2"]);
    expect(snaps.map((s) => s.status)).toEqual(["cancelled", "cancelled"]);
    expect(loop.cancel).toHaveBeenCalledTimes(2);
  });

  it("onEvent 转发 loop 事件（含 agentId 盖章的事件原样透传）", () => {
    const { rt, loop } = runtimeWith(fakeLoop());
    const seen: OutputEvent[] = [];
    rt.onEvent((e) => seen.push(e));
    rt.spawn({ agentType: "novel_explorer", prompt: "p" });
    loop.emit({
      type: "run-start",
      seq: 0,
      conversationId: "c1",
      agentId: "novel_explorer:task_1",
      ts: "2026-08-13T00:00:00.000Z",
      persist: true,
      runSeq: 0,
    } as OutputEvent);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ agentId: "novel_explorer:task_1", conversationId: "c1" });
  });

  it("queryTasks 未知 taskId 忽略、顺序保持", async () => {
    const { rt } = runtimeWith(fakeLoop());
    rt.spawn({ agentType: "novel_explorer", prompt: "p1" });
    rt.spawn({ agentType: "novel_explorer", prompt: "p2" });
    const snaps = await rt.queryTasks(["task_2", "task_99", "task_1"]);
    expect(snaps.map((s) => s.taskId)).toEqual(["task_2", "task_1"]);
  });
});
