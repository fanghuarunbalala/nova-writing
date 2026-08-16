import { describe, it, expect, vi } from "vitest";
import { createSubagentTools } from "../subagent.js";
import type { SubagentToolsOptions } from "../subagent.js";
import { ToolError } from "../../errors.js";
import type { SubagentSpawner, SubagentTaskSnapshot } from "../../../conversation/contract/task.js";
import type { AgentDefinition } from "../../../agent/AgentDefinition.js";
import type { ToolDef } from "../../ToolDef.js";
import type { ToolCall } from "../../../provider/types.js";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "c1", name, args: JSON.stringify(args) };
}

/** 快照工厂（running 缺省） */
function snapshot(over: Partial<SubagentTaskSnapshot> = {}): SubagentTaskSnapshot {
  return {
    taskId: "task_1",
    agentType: "Explore",
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

/** 定义目录 fixture（形状对齐 NOVEL_SUBAGENT_DEFINITIONS） */
const agents: readonly AgentDefinition[] = [
  {
    agentType: "Explore",
    agentVersion: "1.0.0",
    label: "只读探索",
    description: "读取大纲、人物、地点、段落、卷与章节，返回简洁的文本性发现。",
    tools: { allow: ["Read", "Glob"] },
  },
];
const allowedTypes: readonly string[] = ["Explore"];

/** 公共装配（注入定义目录 + 白名单） */
function makeTools(over: Omit<SubagentToolsOptions, "agents" | "allowedAgentTypes">): ToolDef[] {
  return createSubagentTools({ ...over, agents, allowedAgentTypes: allowedTypes });
}

describe("createSubagentTools", () => {
  it("Agent 返回非阻塞 acceptance", async () => {
    const fake = fakeSpawner();
    const [agent] = makeTools({ spawner: fake.spawner });
    expect(agent.name).toBe("Agent");
    const out = await agent.handler.execute(call("Agent", { agentType: "Explore", prompt: "列出角色" }));
    expect(JSON.parse(out)).toEqual({ taskId: "task_1", status: "running" });
    expect(fake.spawner.spawn).toHaveBeenCalledWith({ agentType: "Explore", prompt: "列出角色" });
  });

  it("Agent schema 限制 agentType 枚举（白名单推导）", () => {
    const fake = fakeSpawner();
    const [agent] = makeTools({ spawner: fake.spawner });
    const params = agent.parameters as {
      properties: { agentType: { enum: string[] } };
      required: string[];
    };
    expect(params.properties.agentType.enum).toEqual(["Explore"]);
    expect(params.required).toEqual(["agentType", "prompt"]);
  });

  it("描述含定义推导文案（label/description + 工具清单行）", () => {
    const fake = fakeSpawner();
    const [agent] = makeTools({ spawner: fake.spawner });
    expect(agent.description).toContain("## 允许的子代理类型");
    expect(agent.description).toContain(
      "- Explore（只读探索）：读取大纲、人物、地点、段落、卷与章节，返回简洁的文本性发现。\n  （工具：Read、Glob）",
    );
  });

  it("白名单项不在定义目录 → TOOL_POLICY_INVALID", () => {
    const fake = fakeSpawner();
    try {
      createSubagentTools({ spawner: fake.spawner, agents, allowedAgentTypes: ["ghost"] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_POLICY_INVALID");
      expect((err as Error).message).toContain("白名单含未注册类型: ghost");
    }
  });

  it("空白名单 → TOOL_POLICY_INVALID", () => {
    const fake = fakeSpawner();
    try {
      createSubagentTools({ spawner: fake.spawner, agents, allowedAgentTypes: [] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_POLICY_INVALID");
      expect((err as Error).message).toContain("白名单不能为空");
    }
  });

  it("多类型白名单：enum 推导 + 逐项渲染（无 tools 策略不渲染工具行）", () => {
    const fake = fakeSpawner();
    const compose: AgentDefinition = {
      agentType: "Compose",
      agentVersion: "1.0.0",
      label: "创作助手",
      description: "读取当前故事状态，以文本形式起草大纲与正文设计提案。",
    };
    const [agent] = createSubagentTools({
      spawner: fake.spawner,
      agents: [...agents, compose],
      allowedAgentTypes: ["Compose", "Explore"],
    });
    const params = agent.parameters as { properties: { agentType: { enum: string[] } } };
    expect(params.properties.agentType.enum).toEqual(["Compose", "Explore"]);
    expect(agent.description).toContain(
      "- Compose（创作助手）：读取当前故事状态，以文本形式起草大纲与正文设计提案。",
    );
    expect(agent.description).not.toContain("以文本形式起草大纲与正文设计提案。\n  （工具");
    expect(agent.description).toContain("（工具：Read、Glob）");
  });

  it("TaskOutput 非 block 立即返回快照", async () => {
    const fake = fakeSpawner([snapshot({ status: "completed", result: "2 个角色" })]);
    const [, taskOutput] = makeTools({ spawner: fake.spawner });
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
    const [, taskOutput] = makeTools({ spawner: fake.spawner, pollIntervalMs: 5, defaultTimeoutMs: 1000 });
    const out = await taskOutput.handler.execute(call("TaskOutput", { taskIds: ["task_1"], block: true }));
    expect(JSON.parse(out)[0]).toMatchObject({ status: "completed", result: "done" });
  });

  it("TaskOutput block 超时返回当前快照", async () => {
    const fake = fakeSpawner([snapshot()]);
    const [, taskOutput] = makeTools({ spawner: fake.spawner, pollIntervalMs: 5, defaultTimeoutMs: 40 });
    const start = Date.now();
    const out = await taskOutput.handler.execute(call("TaskOutput", { taskIds: ["task_1"], block: true }));
    expect(JSON.parse(out)[0]).toMatchObject({ status: "running" });
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  it("TaskStop 透传三态结果", async () => {
    const fake = fakeSpawner();
    const [, , taskStop] = makeTools({ spawner: fake.spawner });
    const out = await taskStop.handler.execute(call("TaskStop", { taskId: "task_1" }));
    expect(JSON.parse(out)).toEqual({ outcome: "cancellation_requested" });
    expect(fake.spawner.stopTask).toHaveBeenCalledWith("task_1");
  });

  it("无效 JSON 参数抛 ToolError TOOL_ARGUMENTS_INVALID", async () => {
    const fake = fakeSpawner();
    const [agent] = makeTools({ spawner: fake.spawner });
    try {
      await agent.handler.execute({ id: "c1", name: "Agent", args: "{bad" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_ARGUMENTS_INVALID");
      expect((err as Error).message).toContain("无效的 JSON 参数");
    }
  });
});
