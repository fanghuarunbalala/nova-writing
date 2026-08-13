import { describe, it, expect } from "vitest";
import { buildNovelAgent } from "../NovelAgent.js";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";

const provider: Provider = {
  call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};
const handle = {
  query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
  mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown;

describe("buildNovelAgent 组装", () => {
  it("systemSections 齐全（6 段）+ toolDefs 齐全（20 工具）", () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const cap = (loop as unknown as { config: { agentCapability: { systemSections: unknown[]; toolDefs: unknown[] } } }).config.agentCapability;
    expect(cap.systemSections).toHaveLength(6);
    expect(cap.toolDefs).toHaveLength(20);
  });

  it("工具名覆盖 files + novel 各域", () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const cap = (loop as unknown as { config: { agentCapability: { toolDefs: Array<{ name: string }> } } }).config.agentCapability;
    const names = cap.toolDefs.map((t) => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("Glob");
    expect(names).toContain("Write");
    expect(names).toContain("Edit");
    expect(names).toContain("CharacterRead");
    expect(names).toContain("LocationWrite");
    expect(names).toContain("OutlineEdit");
    expect(names).toContain("ParagraphWrite");
    expect(names).toContain("PublicationRead");
    expect(names).toContain("NovelDelete");
  });

  it("dispatcher 按 name 分发执行工具", async () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const dispatcher = (loop as unknown as { config: { toolDispatcher: { dispatch: (ctx: unknown, call: { name: string }) => Promise<string> } } }).config.toolDispatcher;
    // CharacterRead 会调 handle.query（characters.list）
    const result = await dispatcher.dispatch({} as never, { name: "CharacterRead", args: "{}" } as never);
    expect(result).toContain("[]");
  });

  it("subagent 选项存在时追加 Agent/TaskOutput/TaskStop（23 工具），Agent 返回 acceptance", async () => {
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
            toolDefs: Array<{ name: string; handler: { execute: (c: { id: string; name: string; args: string }) => Promise<string> } }>;
          };
        };
      }
    ).config.agentCapability;
    expect(cap.toolDefs).toHaveLength(23);
    const names = cap.toolDefs.map((t) => t.name);
    expect(names).toContain("Agent");
    expect(names).toContain("TaskOutput");
    expect(names).toContain("TaskStop");
    const agent = cap.toolDefs.find((t) => t.name === "Agent");
    expect(agent).toBeDefined();
    const out = await agent!.handler.execute({
      id: "c1",
      name: "Agent",
      args: JSON.stringify({ agentType: "novel_explorer", prompt: "列出角色" }),
    });
    expect(JSON.parse(out)).toEqual({ taskId: "task_1", status: "running" });
  });
});
