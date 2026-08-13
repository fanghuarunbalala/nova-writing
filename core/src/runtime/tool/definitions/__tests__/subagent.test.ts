import { describe, it, expect, vi } from "vitest";
import { createSubagentTools } from "../subagent.js";
import type { SubagentSpawner, SubagentTaskSnapshot } from "../../../conversation/contract/task.js";
import type { ToolCall } from "../../../provider/types.js";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "c1", name, args: JSON.stringify(args) };
}

/** 快照工厂（running 缺省） */
function snapshot(over: Partial<SubagentTaskSnapshot> = {}): SubagentTaskSnapshot {
  return {
    taskId: "task_1",
    agentType: "novel_explorer",
    status: "running",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...over,
  };
}

/** 可控 fake spawner */
function fakeSpawner(init: SubagentTaskSnapshot[] = []): {
  spawner: SubagentSpawner;
  snapshots: () => SubagentTaskSnapshot[];
  set: (s: SubagentTaskSnapshot[]) => void;
} {
  let current = init;
  return {
    spawner: {
      spawn: vi.fn(() => ({ taskId: "task_1", status: "running" as const })),
      queryTasks: vi.fn(async () => current),
      stopTask: vi.fn(async () => "cancellation_requested" as const),
    },
    snapshots: () => current,
    set: (s) => {
      current = s;
    },
  };
}

describe("createSubagentTools", () => {
  it("Agent 返回非阻塞 acceptance", async () => {
    const fake = fakeSpawner();
    const [agent] = createSubagentTools({ spawner: fake.spawner });
    expect(agent.name).toBe("Agent");
    const out = await agent.handler.execute(call("Agent", { agentType: "novel_explorer", prompt: "列出角色" }));
    expect(JSON.parse(out)).toEqual({ taskId: "task_1", status: "running" });
    expect(fake.spawner.spawn).toHaveBeenCalledWith({ agentType: "novel_explorer", prompt: "列出角色" });
  });

  it("Agent schema 限制 agentType 枚举", () => {
    const fake = fakeSpawner();
    const [agent] = createSubagentTools({ spawner: fake.spawner });
    const params = agent.parameters as {
      properties: { agentType: { enum: string[] } };
      required: string[];
    };
    expect(params.properties.agentType.enum).toEqual(["novel_explorer"]);
    expect(params.required).toEqual(["agentType", "prompt"]);
  });

  it("TaskOutput 非 block 立即返回快照", async () => {
    const fake = fakeSpawner([snapshot({ status: "completed", result: "2 个角色" })]);
    const [, taskOutput] = createSubagentTools({ spawner: fake.spawner });
    const out = await taskOutput.handler.execute(call("TaskOutput", { taskIds: ["task_1"] }));
    expect(JSON.parse(out)).toHaveLength(1);
    expect(JSON.parse(out)[0]).toMatchObject({ taskId: "task_1", status: "completed", result: "2 个角色" });
  });

  it("TaskOutput block 等待到终态即返回", async () => {
    const fake = fakeSpawner();
    // 第 3 次查询翻转为 completed（轮询间隔 5ms）
    let polls = 0;
    vi.mocked(fake.spawner.queryTasks).mockImplementation(async () => {
      polls += 1;
      if (polls >= 3) return [snapshot({ status: "completed", result: "done" })];
      return [snapshot()];
    });
    const [, taskOutput] = createSubagentTools({ spawner: fake.spawner, pollIntervalMs: 5, defaultTimeoutMs: 1000 });
    const out = await taskOutput.handler.execute(call("TaskOutput", { taskIds: ["task_1"], block: true }));
    expect(JSON.parse(out)[0]).toMatchObject({ status: "completed", result: "done" });
  });

  it("TaskOutput block 超时返回当前快照", async () => {
    const fake = fakeSpawner([snapshot()]);
    const [, taskOutput] = createSubagentTools({ spawner: fake.spawner, pollIntervalMs: 5, defaultTimeoutMs: 40 });
    const start = Date.now();
    const out = await taskOutput.handler.execute(call("TaskOutput", { taskIds: ["task_1"], block: true }));
    expect(JSON.parse(out)[0]).toMatchObject({ status: "running" });
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  it("TaskStop 透传三态结果", async () => {
    const fake = fakeSpawner();
    const [, , taskStop] = createSubagentTools({ spawner: fake.spawner });
    const out = await taskStop.handler.execute(call("TaskStop", { taskId: "task_1" }));
    expect(JSON.parse(out)).toEqual({ outcome: "cancellation_requested" });
    expect(fake.spawner.stopTask).toHaveBeenCalledWith("task_1");
  });

  it("无效 JSON 参数抛错", async () => {
    const fake = fakeSpawner();
    const [agent] = createSubagentTools({ spawner: fake.spawner });
    await expect(agent.handler.execute({ id: "c1", name: "Agent", args: "{bad" })).rejects.toThrow(
      "无效的 JSON 参数",
    );
  });
});
