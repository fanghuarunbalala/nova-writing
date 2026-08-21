import { describe, it, expect } from "vitest";
import { buildNovelAgent } from "../NovelAgent.js";
import { ComposeModeStateProvider } from "../../../conversation/compose/ComposeModeState.js";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { ToolDef } from "../../tool/ToolDef.js";

const provider: Provider = {
  call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};
const handle = {
  query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
  mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown;

/** MCP 包装工具夹具（extraTools 通道；受信：无 requireApproval） */
const mcpTool: ToolDef = {
  name: "mcp__server__tool",
  version: "1.0.0",
  description: "[MCP:server] 测试工具",
  handler: { execute: async () => "mcp-ok" },
};

describe("buildNovelAgent 组装", () => {
  it("systemSections 齐全（15 段 recipe 序含 skill.index 专属动态段）+ toolDefs 齐全（15 工具）", () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const cap = (loop as unknown as { config: { agentCapability: { systemSections: Array<{ id: string; kind: string }>; toolDefs: unknown[] } } }).config.agentCapability;
    expect(cap.systemSections).toHaveLength(15);
    expect(cap.systemSections.map((s) => s.id)).toEqual([
      "novel.identity",
      "novel.system",
      "novel.doing-tasks",
      "novel.actions",
      "novel.communication",
      "core.runtime.protocol",
      "novel.story_appeal",
      "novel.outline_standard",
      "novel.prose_standard",
      "novel.publication_standard",
      "tool.policy",
      "tool.guidance",
      "skill.index",
      "core.environment",
      "novel.global_constraints",
    ]);
    // 四规范段 + skill.index 转 dynamic：static 6 + dynamic 9
    expect(cap.systemSections.filter((s) => s.kind === "static")).toHaveLength(6);
    expect(cap.systemSections.filter((s) => s.kind === "dynamic")).toHaveLength(9);
    // library.read 暂不接入 main（定义组序已移除）——book-analyst 分支恢复后回 16
    // 13（6 组）+ 2（runtime.external 外部工具两步模式）
    expect(cap.toolDefs).toHaveLength(15);
  });

  it("工具名覆盖 todo + files + ask + skills + external + compose + novel.entities（7 组 15 工具；library.read 暂不接入）", () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const cap = (loop as unknown as { config: { agentCapability: { toolDefs: Array<{ name: string }> } } }).config.agentCapability;
    const names = cap.toolDefs.map((t) => t.name);
    expect(names[0]).toBe("TodoWrite"); // runtime.todo 组在组序首位
    expect(names).toContain("Read");
    expect(names).toContain("Glob");
    expect(names).toContain("Write");
    expect(names).toContain("Edit");
    expect(names).toContain("AskUserQuestion");
    expect(names).toContain("skill");
    expect(names).toContain("SearchExtraTools");
    expect(names).toContain("ExecuteExtraTool");
    expect(names).toContain("EnterComposeMode");
    expect(names).toContain("ExitComposeMode");
    expect(names).toContain("NovelRead");
    expect(names).toContain("NovelWrite");
    expect(names).toContain("NovelEdit");
    expect(names).toContain("NovelDelete");
  });

  it("dispatcher 按 name 分发执行工具", async () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const dispatcher = (loop as unknown as { config: { toolDispatcher: { dispatch: (ctx: unknown, call: { name: string }) => Promise<string> } } }).config.toolDispatcher;
    // NovelRead kind=character 会调 handle.query（characters.list）
    const result = await dispatcher.dispatch({} as never, { name: "NovelRead", args: '{"kind":"character"}' } as never);
    expect(result).toContain("[]");
  });

  it("subagent 选项存在时追加 Agent/TaskOutput/TaskStop（16 工具），Agent 返回 acceptance", async () => {
    const spawner = {
      spawn: () => ({ taskId: "task_1", status: "running" as const }),
      queryTasks: async () => [],
      stopTask: async () => "not_found" as const,
    };
    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      subagent: { spawner },
    });
    const cap = (
      loop as unknown as {
        config: {
          agentCapability: {
            toolDefs: Array<{
              name: string;
              description: string;
              parameters: { properties: { agentType: { enum: string[] } } };
              handler: { execute: (c: { id: string; name: string; args: string }) => Promise<string> };
              promptDetail?: { policy?: string; guidance?: string };
            }>;
          };
        };
      }
    ).config.agentCapability;
    // 15（7 组，含 runtime.external 两工具与 novel.entities 四工具与 novel.compose 两工具） + 3（subagent 派发三工具）
    expect(cap.toolDefs).toHaveLength(18);
    const names = cap.toolDefs.map((t) => t.name);
    expect(names).toContain("Agent");
    expect(names).toContain("TaskOutput");
    expect(names).toContain("TaskStop");
    const agent = cap.toolDefs.find((t) => t.name === "Agent");
    expect(agent).toBeDefined();
    // Agent 的 policy 优先级行（委托纪律）
    expect(agent!.promptDetail?.policy).toContain("Explore");
    // 白名单由 novelAgentDefinition.delegation.allowedAgentTypes 派生（explorer + compose）
    expect(agent!.description).toContain("- Explore（只读探索）：");
    expect(agent!.description).toContain("- Compose（草案创作）：");
    expect((agent!.parameters as { properties: { agentType: { enum: string[] } } }).properties.agentType.enum).toEqual([
      "Explore",
      "Compose",
    ]);
    const out = await agent!.handler.execute({
      id: "c1",
      name: "Agent",
      args: JSON.stringify({ agentType: "Explore", prompt: "列出角色" }),
    });
    expect(JSON.parse(out)).toEqual({ taskId: "task_1", status: "running" });
  });

  it("TodoWrite 装配：执行写读（缺省 InMemoryConversationTodoStore）", async () => {
    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      conversationId: "conv-1",
    });
    const dispatcher = (loop as unknown as { config: { toolDispatcher: { dispatch: (ctx: unknown, call: { name: string; args: string }) => Promise<string> } } }).config.toolDispatcher;
    const result = await dispatcher.dispatch({} as never, {
      name: "TodoWrite",
      args: JSON.stringify({
        todos: [{ content: "写第一章", status: "in_progress", activeForm: "写第一章中" }],
      }),
    } as never);
    expect(result).toContain("写第一章");
  });

  it("nudge 接线：todo_idle/project_stage/external_tools 恒注入；compose_mode 需 composeState（enabled ∩ 目录）", () => {
    const withoutCompose = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
    });
    const capNoCompose = (withoutCompose as unknown as { config: { agentCapability: { nudgePolicies: Array<{ constructor: { name: string } }> } } }).config.agentCapability;
    expect(capNoCompose.nudgePolicies.map((n) => n.constructor.name)).toEqual([
      "TodoIdleNudgePolicy",
      "ProjectStageNudgePolicy",
      "ExternalToolsNudgePolicy",
    ]);
    const withCompose = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      conversationId: "conv-1",
      composeState: new ComposeModeStateProvider(),
    });
    const capCompose = (withCompose as unknown as { config: { agentCapability: { nudgePolicies: Array<{ constructor: { name: string } }> } } }).config.agentCapability;
    // enabled 声明序：compose_mode 在前
    expect(capCompose.nudgePolicies.map((n) => n.constructor.name)).toEqual([
      "ComposeModeNudgePolicy",
      "TodoIdleNudgePolicy",
      "ProjectStageNudgePolicy",
      "ExternalToolsNudgePolicy",
    ]);
  });

  it("extraTools 进延迟池：toolDefs 不含 mcp__ 名；stub 拦截直接调用；ExecuteExtraTool 经 dispatcher 执行", async () => {
    const loop = buildNovelAgent({
      workspace: "/ws",
      provider,
      handle: handle as NovelHandle,
      extraTools: [mcpTool],
    });
    const cap = (
      loop as unknown as { config: { agentCapability: { toolDefs: Array<{ name: string }> } } }
    ).config.agentCapability;
    const names = cap.toolDefs.map((t) => t.name);
    // 常驻工具面：两步工具在、MCP 工具不在（schema 不进 provider call / tool.policy 名单）
    expect(names).toContain("SearchExtraTools");
    expect(names).toContain("ExecuteExtraTool");
    expect(names).not.toContain("mcp__server__tool");
    const dispatcher = (loop as unknown as {
      config: { toolDispatcher: { dispatch: (ctx: unknown, call: { name: string; args: string }) => Promise<string> } };
    }).config.toolDispatcher;
    // 直接调用延迟工具：stub 拦截引导两步流程
    await expect(
      dispatcher.dispatch({} as never, { name: "mcp__server__tool", args: "{}" } as never),
    ).rejects.toThrow(/SearchExtraTools/);
    // 受信目标经 ExecuteExtraTool 免审直执行
    const result = await dispatcher.dispatch(
      {} as never,
      { name: "ExecuteExtraTool", args: JSON.stringify({ tool_name: "mcp__server__tool", params: {} }) } as never,
    );
    expect(result).toBe("mcp-ok");
  });
});
