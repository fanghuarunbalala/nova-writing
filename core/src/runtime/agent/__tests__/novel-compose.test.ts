import { describe, it, expect } from "vitest";
import {
  buildNovelComposeAgent,
  NOVEL_COMPOSE_TOOL_NAMES,
} from "../NovelComposeAgent.js";
import { NOVEL_SUBAGENT_DEFINITIONS, novelComposeAgentDefinition } from "../definitions/index.js";
import { novelComposeProcessSection, novelComposeReportingSection } from "../../prompt/sections/novel.js";
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

function build(
  todoStore = new InMemoryConversationTodoStore(),
  overrides?: Partial<Parameters<typeof buildNovelComposeAgent>[0]>,
) {
  return buildNovelComposeAgent({
    workspace: "/ws",
    provider,
    handle: handle as NovelHandle,
    todoStore,
    conversationId: "c1",
    agentId: "Compose:task_1",
    ...overrides,
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

  it("systemSections 14 段 recipe 序（explorer 框架 + compose 四段 + 三质量规范段 + guide 动态段 + toolPolicy/toolGuidance 收尾）", () => {
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
      "novel.story_appeal",
      "novel.outline_standard",
      "novel.prose_standard",
      "novel.compose.guide",
      "tool.policy",
      "tool.guidance",
    ]);
    // guide 为 dynamic 段且位于 prose_standard 之后（PRD compose-案例引导 F8）
    const guide = cfg.agentCapability.systemSections.find((s) => s.id === "novel.compose.guide");
    expect(guide?.kind).toBe("dynamic");
  });

  it("definitionVersion 1.2.0（guide 段入 recipe）", () => {
    expect(novelComposeAgentDefinition.definitionVersion).toBe("1.2.0");
  });

  it("config 盖章 conversationId + agentId，且无 listeners（live-only）", () => {
    const cfg = cfgOf(build());
    expect(cfg.conversationId).toBe("c1");
    expect(cfg.agentId).toBe("Compose:task_1");
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
    const entry = NOVEL_SUBAGENT_DEFINITIONS.find((d) => d.agentType === "Compose");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("草案创作");
    expect(entry!.description).toContain("草案");
    expect(entry!.tools?.allow).toEqual([...NOVEL_COMPOSE_TOOL_NAMES]);
  });
});

describe("Compose prompt 段内容（legacy 迁移 + 工具名适配）", () => {
  it("process 段含通用工具名与 kind 分发表述（novel-tools-通用合并）", () => {
    const text = novelComposeProcessSection.render();
    expect(text).toContain("NovelRead");
    expect(text).toContain("kind");
    // 旧六域三件套名不应再出现
    for (const name of ["NovelOutlineRead", "NovelCharacterRead", "NovelLocationRead", "NovelParagraphRead", "NovelVolumeRead", "NovelChapterRead"]) {
      expect(text).not.toContain(name);
    }
  });

  it("process/reporting 段含案例引导协议（v1.1.0：对照 + 自报）", () => {
    const process = novelComposeProcessSection.render();
    expect(process).toContain("<novel-guide>");
    expect(process).toContain(".novel/cases/");
    const reporting = novelComposeReportingSection.render();
    expect(reporting).toContain("参考案例");
  });
});

describe("Compose 案例引导装配（novel-guide，PRD compose-案例引导 集成）", () => {
  it("composeGuideProvider 进 system 尾部、composeGuideSeed 注入首 run 紧随委派 prompt", async () => {
    const calls: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
    const captureProvider: Provider = {
      call: async (call) => {
        calls.push({
          system: call.system,
          messages: call.messages.map((m) => ({ role: m.role, content: m.content })),
        });
        return { finishReason: "stop", message: { role: "assistant", content: "ok" } };
      },
    };
    const loop = build(new InMemoryConversationTodoStore(), {
      provider: captureProvider,
      composeGuideProvider: async () => ({
        index: "- .novel/cases/outline-refine.md ｜ task=outline-refine ｜ 大纲细化",
        casesDir: ".novel/cases",
      }),
      composeGuideSeed: async () => [
        { role: "system", content: "<novel-guide>\n案例正文\n</novel-guide>" },
      ],
    });
    await loop.run("把 S3 细化为子故事", { sampling: { model: "m" } });
    expect(calls).toHaveLength(1);
    // system：guide 段渲染（索引 + 背书）
    expect(calls[0].system).toContain("# 任务案例引导");
    expect(calls[0].system).toContain(".novel/cases/outline-refine.md");
    expect(calls[0].system).toContain("起草前必须对照");
    // 段序：guide 在 prose_standard 之后、tool.policy 之前
    expect(calls[0].system.indexOf("# 任务案例引导")).toBeGreaterThan(
      calls[0].system.indexOf("正文规范"),
    );
    // 消息序：user(委派) → system(novel-guide)
    expect(calls[0].messages.map((m) => m.role)).toEqual(["user", "system"]);
    expect(calls[0].messages[1].content).toContain("<novel-guide>");
  });

  it("seed 钩子抛错 → 不阻断任务（降级不注入）", async () => {
    const loop = build(new InMemoryConversationTodoStore(), {
      composeGuideSeed: async () => {
        throw new Error("classifier down");
      },
    });
    const r = await loop.run("任务", { sampling: { model: "m" } });
    expect(r.final.content).toBe("ok");
  });
});
