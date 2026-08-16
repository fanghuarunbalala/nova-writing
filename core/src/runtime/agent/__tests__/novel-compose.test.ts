import { describe, it, expect } from "vitest";
import {
  buildNovelComposeAgent,
  NOVEL_COMPOSE_TOOL_NAMES,
} from "../NovelComposeAgent.js";
import { NOVEL_SUBAGENT_DEFINITIONS } from "../definitions/index.js";
import { novelComposeProcessSection } from "../../prompt/sections/novel.js";
import { InMemoryConversationTodoStore } from "../../todo/InMemoryConversationTodoStore.js";
import type { Provider } from "../../provider/Provider.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import type { ToolCall } from "../../provider/types.js";
import type { PromptSection } from "../../prompt/PromptSection.js";

const provider: Provider = {
  call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
};
const handle = {
  query: async (q: { op: string }) => (q.op === "characters.list" ? [] : {}),
  mutate: async () => ({ version: 1, changeId: "x", entity: "character" }),
} as unknown;

function build(todoStore = new InMemoryConversationTodoStore()) {
  return buildNovelComposeAgent({
    workspace: "/ws",
    provider,
    handle: handle as NovelHandle,
    todoStore,
    conversationId: "c1",
    agentId: "novel_compose:task_1",
  });
}

/** 取 loop config（测试穿透，同 novel-explorer.test.ts 风格） */
function cfgOf(loop: ReturnType<typeof build>) {
  return (
    loop as unknown as {
      config: {
        agentCapability: {
          systemSections: Array<{ id: string; kind: string } & PromptSection>;
          toolDefs: Array<{ name: string }>;
        };
        toolDispatcher: { dispatch: (ctx: unknown, call: ToolCall) => Promise<string> };
        conversationId?: string;
        agentId?: string;
        listeners?: unknown[];
      };
    }
  ).config;
}

describe("buildNovelComposeAgent 装配", () => {
  it("工具名精确 = 9 只读名单（与 explorer 同构，无写/删/Agent）", () => {
    const cfg = cfgOf(build());
    const names = cfg.agentCapability.toolDefs.map((t) => t.name);
    expect(names).toEqual([...NOVEL_COMPOSE_TOOL_NAMES]);
    for (const n of ["Write", "Edit", "NovelDelete", "CharacterWrite", "LocationEdit", "PublicationEdit", "Agent", "TaskOutput", "TaskStop"]) {
      expect(names).not.toContain(n);
    }
  });

  it("systemSections 10 段 recipe 序（explorer 框架 + compose 四段 + toolPolicy/toolGuidance 收尾）", () => {
    const cfg = cfgOf(build());
    expect(cfg.agentCapability.systemSections.map((s) => s.id)).toEqual([
      "core.runtime.protocol",
      "context.reliability",
      "completion.contract",
      "todo.guidance",
      "novel.compose.identity",
      "novel.compose.system",
      "novel.compose.process",
      "novel.compose.reporting",
      "tool.policy",
      "tool.guidance",
    ]);
  });

  it("config 盖章 conversationId + agentId，且无 listeners（live-only）", () => {
    const cfg = cfgOf(build());
    expect(cfg.conversationId).toBe("c1");
    expect(cfg.agentId).toBe("novel_compose:task_1");
    expect(cfg.listeners).toBeUndefined();
  });

  it("dispatcher 遇未知工具抛错（写工具不可达）", async () => {
    const cfg = cfgOf(build());
    await expect(cfg.toolDispatcher.dispatch({} as never, { id: "c1", name: "CharacterWrite", args: "{}" })).rejects.toThrow(
      "未知工具: CharacterWrite",
    );
  });

  it("TodoWrite handler 经注入 store 往返", async () => {
    const todoStore = new InMemoryConversationTodoStore();
    const cfg = cfgOf(build(todoStore));
    await cfg.toolDispatcher.dispatch(
      {} as never,
      { id: "c1", name: "TodoWrite", args: JSON.stringify({ todos: [{ content: "梳理第一卷设定", status: "in_progress", activeForm: "正在梳理第一卷设定" }] }) },
    );
    const snapshot = await todoStore.read("c1");
    expect(snapshot?.todos).toHaveLength(1);
    expect(snapshot?.todos[0]).toMatchObject({ content: "梳理第一卷设定", status: "in_progress" });
  });

  it("目录条目从声明式定义派生（agentType/label/description/tools 策略）", () => {
    const entry = NOVEL_SUBAGENT_DEFINITIONS.find((d) => d.agentType === "novel_compose");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("草案创作");
    expect(entry!.description).toContain("草案");
    expect(entry!.tools?.allow).toEqual([...NOVEL_COMPOSE_TOOL_NAMES]);
  });
});

describe("novel_compose prompt 段内容（legacy 迁移 + 工具名适配）", () => {
  it("process 段含现注册表工具名（P1 legacy 对齐 Novel* 命名）", () => {
    const text = novelComposeProcessSection.render();
    for (const name of ["NovelOutlineRead", "NovelCharacterRead", "NovelLocationRead", "NovelParagraphRead", "NovelVolumeRead", "NovelChapterRead"]) {
      expect(text).toContain(name);
    }
    // 旧短名（不带 Novel 前缀）不应再独立出现：其后必跟 Nov 前缀形态之外的残句
    //（substring 判定不可用——NovelCharacterRead 含 CharacterRead 子串）
  });
});
