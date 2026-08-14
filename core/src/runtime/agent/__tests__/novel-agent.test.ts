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
  it("systemSections 齐全（9 段 recipe 序）+ toolDefs 齐全（20 工具）", () => {
    const loop = buildNovelAgent({ workspace: "/ws", provider, handle: handle as NovelHandle });
    const cap = (loop as unknown as { config: { agentCapability: { systemSections: Array<{ id: string; kind: string }>; toolDefs: unknown[] } } }).config.agentCapability;
    expect(cap.systemSections).toHaveLength(9);
    expect(cap.systemSections.map((s) => s.id)).toEqual([
      "novel.identity",
      "novel.system",
      "novel.doing-tasks",
      "novel.actions",
      "novel.communication",
      "core.runtime.protocol",
      "core.environment",
      "novel.global_constraints",
      "tool.guidance",
    ]);
    expect(cap.systemSections.filter((s) => s.kind === "static")).toHaveLength(6);
    expect(cap.systemSections.filter((s) => s.kind === "dynamic")).toHaveLength(3);
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
});
