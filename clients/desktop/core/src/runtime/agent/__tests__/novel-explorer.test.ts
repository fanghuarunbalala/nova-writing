import { describe, it, expect } from "vitest";
import {
  buildNovelExplorerAgent,
  NOVEL_EXPLORER_TOOL_NAMES,
} from "../NovelExplorerAgent.js";
import { NOVEL_SUBAGENT_DEFINITIONS } from "../definitions/index.js";
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
    agentId: "Explore:task_1",
  });
}

/** 取 loop config（测试穿透，同 novel-agent.test.ts 风格） */
function cfgOf(loop: ReturnType<typeof build>) {
  return (
    loop as unknown as {
      config: {
        agentCapability: {
          systemSections: unknown[];
          toolDefs: Array<{ name: string }>;
          nudgePolicies: Array<{ constructor: { name: string } }>;
        };
        toolDispatcher: { dispatch: (ctx: unknown, call: ToolCall) => Promise<string> };
        conversationId?: string;
        agentId?: string;
        listeners?: unknown[];
      };
    }
  ).config;
}

describe("buildNovelExplorerAgent 装配", () => {
  it("工具名精确 = 4 只读名单（无文件/实体写入与 Agent）", () => {
    const cfg = cfgOf(build());
    const names = cfg.agentCapability.toolDefs.map((t) => t.name);
    expect(names).toEqual([...NOVEL_EXPLORER_TOOL_NAMES]);
    for (const n of ["Write", "Edit", "NovelDelete", "NovelWrite", "NovelEdit", "Agent", "TaskOutput", "TaskStop"]) {
      expect(names).not.toContain(n);
    }
  });

  it("systemSections 7 段（跳过 conversationBehavior 与 novel 创作 4 段；tool.policy/tool.guidance 收尾）", () => {
    const cfg = cfgOf(build());
    expect(cfg.agentCapability.systemSections).toHaveLength(7);
  });

  it("nudge 接线：max_turn（子代理目录仅此一项）", () => {
    const cfg = cfgOf(build());
    expect(cfg.agentCapability.nudgePolicies.map((n) => n.constructor.name)).toEqual([
      "MaxTurnNudgePolicy",
    ]);
  });

  it("config 盖章 conversationId + agentId，且无 listeners（live-only）", () => {
    const cfg = cfgOf(build());
    expect(cfg.conversationId).toBe("c1");
    expect(cfg.agentId).toBe("Explore:task_1");
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

  it("目录条目从声明式定义派生（agentType/label/description/tools 策略）", () => {
    const entry = NOVEL_SUBAGENT_DEFINITIONS.find((d) => d.agentType === "Explore");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("只读探索");
    expect(entry!.description).toBeTruthy();
    expect(entry!.tools?.allow).toEqual([...NOVEL_EXPLORER_TOOL_NAMES]);
  });
});
