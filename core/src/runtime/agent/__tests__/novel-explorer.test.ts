import { describe, it, expect } from "vitest";
import {
  buildNovelExplorerAgent,
  NOVEL_EXPLORER_DEFINITION,
  NOVEL_EXPLORER_TOOL_NAMES,
} from "../NovelExplorerAgent.js";
import { InMemoryConversationTodoStore } from "../../todo/InMemoryConversationTodoStore.js";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { ToolCall } from "../../provider/types.js";

const provider: Provider = {
  call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};
const handle = {
  query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
  mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown;

function build(todoStore = new InMemoryConversationTodoStore()) {
  return buildNovelExplorerAgent({
    workspace: "/ws",
    provider,
    handle: handle as NovelHandle,
    todoStore,
    conversationId: "c1",
    agentId: "novel_explorer:task_1",
  });
}

/** 取 loop config（测试穿透，同 novel-agent.test.ts 风格） */
function cfgOf(loop: ReturnType<typeof build>) {
  return (
    loop as unknown as {
      config: {
        agentCapability: { systemSections: unknown[]; toolDefs: Array<{ name: string }> };
        toolDispatcher: { dispatch: (ctx: unknown, call: ToolCall) => Promise<string> };
        conversationId?: string;
        agentId?: string;
        listeners?: unknown[];
      };
    }
  ).config;
}

describe("buildNovelExplorerAgent 装配", () => {
  it("工具名精确 = 8 只读名单（无 Write/Edit/Delete/Agent）", () => {
    const cfg = cfgOf(build());
    const names = cfg.agentCapability.toolDefs.map((t) => t.name);
    expect(names).toEqual([...NOVEL_EXPLORER_TOOL_NAMES]);
    for (const n of ["Write", "Edit", "NovelDelete", "CharacterWrite", "LocationEdit", "Agent", "TaskOutput", "TaskStop"]) {
      expect(names).not.toContain(n);
    }
  });

  it("systemSections 6 段（跳过 conversationBehavior 与 novel 创作 4 段）", () => {
    const cfg = cfgOf(build());
    expect(cfg.agentCapability.systemSections).toHaveLength(6);
  });

  it("config 盖章 conversationId + agentId，且无 listeners（live-only）", () => {
    const cfg = cfgOf(build());
    expect(cfg.conversationId).toBe("c1");
    expect(cfg.agentId).toBe("novel_explorer:task_1");
    expect(cfg.listeners).toBeUndefined();
  });

  it("dispatcher 遇未知工具抛错（写工具不可达）", async () => {
    const cfg = cfgOf(build());
    await expect(cfg.toolDispatcher.dispatch({} as never, { id: "c1", name: "Write", args: "{}" })).rejects.toThrow(
      "未知工具: Write",
    );
  });

  it("TodoWrite handler 经注入 store 往返", async () => {
    const todoStore = new InMemoryConversationTodoStore();
    const cfg = cfgOf(build(todoStore));
    await cfg.toolDispatcher.dispatch(
      {} as never,
      { id: "c1", name: "TodoWrite", args: JSON.stringify({ todos: [{ content: "盘点角色", status: "in_progress", activeForm: "正在盘点角色" }] }) },
    );
    const snapshot = await todoStore.read("c1");
    expect(snapshot?.todos).toHaveLength(1);
    expect(snapshot?.todos[0]).toMatchObject({ content: "盘点角色", status: "in_progress" });
  });

  it("NOVEL_EXPLORER_DEFINITION 数据常量对齐（label/description/tools 策略，agentId 缺省）", () => {
    expect(NOVEL_EXPLORER_DEFINITION.agentType).toBe("novel_explorer");
    expect(NOVEL_EXPLORER_DEFINITION.agentVersion).toBe("1.0.0");
    expect(NOVEL_EXPLORER_DEFINITION.label).toBe("只读探索");
    expect(NOVEL_EXPLORER_DEFINITION.description).toBeTruthy();
    expect(NOVEL_EXPLORER_DEFINITION.tools?.allow).toEqual([...NOVEL_EXPLORER_TOOL_NAMES]);
    expect(NOVEL_EXPLORER_DEFINITION.agentId).toBeUndefined();
  });
});
