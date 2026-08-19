import { describe, it, expect, vi } from "vitest";
import { createNovelEntityTools } from "../novel.js";
import type { NovelHandle } from "../../../../novel/client/NovelHandle.js";
import type { ToolCall } from "../../../provider/types.js";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "c1", name, args: JSON.stringify(args) };
}

function mockHandle(): {
  handle: NovelHandle;
  query: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  mutateBatch: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue([]);
  const mutate = vi.fn().mockResolvedValue({ ok: true });
  const mutateBatch = vi.fn().mockResolvedValue([]);
  const handle = { query, mutate, mutateBatch } as unknown as NovelHandle;
  return { handle, query, mutate, mutateBatch };
}

function toolOf(handle: NovelHandle, name: string) {
  const tool = createNovelEntityTools(handle).find((t) => t.name === name);
  if (tool === undefined) throw new Error(`missing tool: ${name}`);
  return tool;
}

describe("NovelRead（kind 分发）", () => {
  it("kind=character 无 id → characters.list；有 id → characters.get", async () => {
    const { handle, query } = mockHandle();
    const read = toolOf(handle, "NovelRead");
    await read.handler.execute(call("NovelRead", { kind: "character" }));
    expect(query).toHaveBeenCalledWith({ op: "characters.list" });
    await read.handler.execute(call("NovelRead", { kind: "character", characterId: "c1" }));
    expect(query).toHaveBeenCalledWith({ op: "characters.get", characterId: "c1" });
  });

  it("kind=story_unit：includePlans 透传（全树 / 单元）", async () => {
    const { handle, query } = mockHandle();
    query.mockResolvedValue({ outline: {}, units: [] });
    const read = toolOf(handle, "NovelRead");
    await read.handler.execute(call("NovelRead", { kind: "story_unit", includePlans: true }));
    expect(query).toHaveBeenCalledWith({ op: "outline.get", includePlans: true });
    await read.handler.execute(call("NovelRead", { kind: "story_unit", storyUnitId: "su_1", includePlans: true }));
    expect(query).toHaveBeenCalledWith({ op: "outline.storyUnit.get", storyUnitId: "su_1", includePlans: true });
  });

  it("kind=overview → overview.get", async () => {
    const { handle, query } = mockHandle();
    query.mockResolvedValue({ title: "书名", counts: {} });
    const read = toolOf(handle, "NovelRead");
    const result = await read.handler.execute(call("NovelRead", { kind: "overview" }));
    expect(query).toHaveBeenCalledWith({ op: "overview.get" });
    expect(JSON.parse(result)).toEqual({ title: "书名", counts: {} });
  });

  it("kind=volume → publication.get 投影 id/title/orderKey", async () => {
    const { handle, query } = mockHandle();
    query.mockResolvedValue({
      structure: {},
      volumes: [{ id: "v1", title: "第一卷", orderKey: "0001", entityVersion: 2 }],
      chapters: [],
    });
    const read = toolOf(handle, "NovelRead");
    const result = await read.handler.execute(call("NovelRead", { kind: "volume" }));
    expect(query).toHaveBeenCalledWith({ op: "publication.get" });
    expect(JSON.parse(result)).toEqual({ volumes: [{ id: "v1", title: "第一卷", orderKey: "0001" }] });
  });

  it("kind 与参数不匹配 → TOOL_ARGUMENTS_INVALID", async () => {
    const { handle } = mockHandle();
    const read = toolOf(handle, "NovelRead");
    await expect(read.handler.execute(call("NovelRead", { kind: "volume", characterId: "c1" }))).rejects.toThrow(
      /kind=volume 不支持参数 characterId/,
    );
    await expect(read.handler.execute(call("NovelRead", {}))).rejects.toThrow(/缺少必填参数 kind/);
    await expect(read.handler.execute(call("NovelRead", { kind: "ghost" }))).rejects.toThrow(/未知 kind/);
  });
});

describe("NovelWrite（kind 分发）", () => {
  it("kind=character → mutateBatch（character.create 逐项，id 透传）", async () => {
    const { handle, mutateBatch } = mockHandle();
    mutateBatch.mockResolvedValue([{ version: 1, changeId: "char_x", entity: "character" }]);
    const write = toolOf(handle, "NovelWrite");
    const result = await write.handler.execute(
      call("NovelWrite", { kind: "character", values: [{ name: "林默" }, { id: "hero", name: "沈砚" }] }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "character.create", id: undefined, input: { name: "林默", aliases: undefined, summary: undefined, initialState: undefined, authorNotes: undefined } },
      { op: "character.create", id: "hero", input: { name: "沈砚", aliases: undefined, summary: undefined, initialState: undefined, authorNotes: undefined } },
    ]);
    expect(JSON.parse(result)).toEqual({
      items: [{ id: "char_x", status: "applied", version: 1 }],
    });
  });

  it("kind=character 预检：自选 id 已占用 → duplicate_id 错误，不执行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockResolvedValue([{ id: "hero", entityVersion: 1, name: "旧角色" }]);
    const write = toolOf(handle, "NovelWrite");
    await expect(
      write.precheck?.(call("NovelWrite", { kind: "character", values: [{ id: "hero", name: "沈砚" }] })),
    ).rejects.toThrow(/duplicate_id/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });

  it("kind=story_unit：leaf/blockState 随创建透传", async () => {
    const { handle, mutateBatch, query } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "characters.list") return [{ id: "char_hero", entityVersion: 1 }];
      if (q.op === "outline.get") return { outline: {}, units: [] };
      return [];
    });
    mutateBatch.mockResolvedValue([{ version: 1, changeId: "su_1", entity: "outline" }]);
    const leaf = { settingMode: "located", characters: [{ characterId: "char_hero" }], locations: [], events: [], rhythmBeats: [], entityChanges: [] };
    const write = toolOf(handle, "NovelWrite");
    await write.handler.execute(
      call("NovelWrite", {
        kind: "story_unit",
        values: [{ title: "场景", leaf, blockState: { dependencyIds: [], blockedAt: "t" } }],
      }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        op: "outline.storyUnit.create",
        leaf,
        blockState: { dependencyIds: [], blockedAt: "t" },
      }),
    ]);
  });

  it("kind=story_unit 预检：leaf 引用不存在角色 → 拒绝，不执行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "characters.list") return [];
      if (q.op === "outline.get") return { outline: {}, units: [] };
      return [];
    });
    const write = toolOf(handle, "NovelWrite");
    await expect(
      write.precheck?.(
        call("NovelWrite", {
          kind: "story_unit",
          values: [
            {
              title: "场景",
              leaf: { settingMode: "located", characters: [{ characterId: "ghost" }], locations: [], events: [], rhythmBeats: [], entityChanges: [] },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/ghost/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });

  it("kind 校验：overview / 不适用字段 / 缺必填 → TOOL_ARGUMENTS_INVALID", async () => {
    const { handle } = mockHandle();
    const write = toolOf(handle, "NovelWrite");
    await expect(
      write.handler.execute(call("NovelWrite", { kind: "overview", values: [] })),
    ).rejects.toThrow(/非法的 kind/);
    await expect(
      write.handler.execute(call("NovelWrite", { kind: "paragraph", values: [{ name: "x", text: "t", storyUnitId: "su" }] })),
    ).rejects.toThrow(/不支持字段 name/);
    await expect(
      write.handler.execute(call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su" }] })),
    ).rejects.toThrow(/缺少必填字段 text/);
    await expect(write.handler.execute(call("NovelWrite", { kind: "volume", values: [] }))).rejects.toThrow(
      /values 不能为空/,
    );
  });

  it("kind=paragraph 节奏标注：rhythm/intensity 必填 + 枚举/范围校验；合法写入透传", async () => {
    const { handle, mutateBatch } = mockHandle();
    const write = toolOf(handle, "NovelWrite");
    // 缺 rhythm / 缺 intensity → 拒
    await expect(
      write.handler.execute(call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su", text: "他抬头。" }] })),
    ).rejects.toThrow(/rhythm/);
    await expect(
      write.handler.execute(
        call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su", text: "他抬头。", rhythm: "turn" }] }),
      ),
    ).rejects.toThrow(/intensity 必填/);
    // 枚举外 / 范围外 / 非整数 → 拒
    await expect(
      write.handler.execute(
        call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su", text: "他抬头。", rhythm: "boom", intensity: 3 }] }),
      ),
    ).rejects.toThrow(/rhythm 必须/);
    await expect(
      write.handler.execute(
        call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su", text: "他抬头。", rhythm: "turn", intensity: 0 }] }),
      ),
    ).rejects.toThrow(/intensity 必填/);
    await expect(
      write.handler.execute(
        call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su", text: "他抬头。", rhythm: "turn", intensity: 3.5 }] }),
      ),
    ).rejects.toThrow(/intensity 必填/);
    // 合法 → mutateBatch 透传 beat 字段
    await write.handler.execute(
      call("NovelWrite", { kind: "paragraph", values: [{ storyUnitId: "su", text: "他抬头。", rhythm: "turn", intensity: 4 }] }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "paragraph.insert", id: undefined, storyUnitId: "su", orderKey: undefined, text: "他抬头。", rhythm: "turn", intensity: 4 },
    ]);
  });

  it("kind=paragraph Edit：rhythm/intensity 可单独 patch；枚举外仍拒绝", async () => {
    const { handle, mutateBatch, query } = mockHandle();
    query.mockResolvedValue({ id: "p1", entityVersion: 2 });
    mutateBatch.mockResolvedValue([{ version: 3, changeId: "p1", entity: "paragraph" }]);
    const edit = toolOf(handle, "NovelEdit");
    await edit.handler.execute(
      call("NovelEdit", { kind: "paragraph", values: [{ id: "p1", baseRevision: 2, value: { rhythm: "climax", intensity: 5 } }] }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "paragraph.update", paragraphId: "p1", baseRevision: 2, text: undefined, storyUnitId: undefined, orderKey: undefined, rhythm: "climax", intensity: 5 },
    ]);
    await expect(
      edit.handler.execute(
        call("NovelEdit", { kind: "paragraph", values: [{ id: "p1", baseRevision: 2, value: { intensity: 9 } }] }),
      ),
    ).rejects.toThrow(/intensity 必填/);
    await expect(
      edit.handler.execute(
        call("NovelEdit", { kind: "paragraph", values: [{ id: "p1", baseRevision: 2, value: { rhythm: "nope" } }] }),
      ),
    ).rejects.toThrow(/rhythm 必须/);
  });
});

describe("NovelEdit（kind 分发）", () => {
  it("kind=character → mutateBatch（character.update，{id, baseRevision, value} 形状）", async () => {
    const { handle, mutateBatch } = mockHandle();
    mutateBatch.mockResolvedValue([{ version: 4, changeId: "c1", entity: "character" }]);
    const edit = toolOf(handle, "NovelEdit");
    await edit.handler.execute(
      call("NovelEdit", { kind: "character", values: [{ id: "c1", baseRevision: 3, value: { summary: "剑客" } }] }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "character.update", characterId: "c1", baseRevision: 3, patch: { summary: "剑客" } },
    ]);
  });

  it("kind=character 预检：版本过期 → 附当前版本的错误，不执行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockResolvedValue([{ id: "c1", entityVersion: 7, name: "张三" }]);
    const edit = toolOf(handle, "NovelEdit");
    await expect(
      edit.precheck?.(call("NovelEdit", { kind: "character", values: [{ id: "c1", baseRevision: 3, value: { summary: "x" } }] })),
    ).rejects.toThrow(/当前 entityVersion 7/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });

  it("kind=story_unit 预检：blockState 依赖不存在的单元 → 拒绝", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "outline.get")
        return { outline: {}, units: [{ id: "su_1", entityVersion: 1 }] };
      return [];
    });
    const edit = toolOf(handle, "NovelEdit");
    await expect(
      edit.precheck?.(
        call("NovelEdit", {
          kind: "story_unit",
          values: [
            {
              id: "su_1",
              baseRevision: 1,
              value: { blockState: { dependencyIds: ["su_ghost"], blockedAt: "t" } },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/su_ghost/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });

  it("value 字段校验：kind 不适用字段 → TOOL_ARGUMENTS_INVALID", async () => {
    const { handle } = mockHandle();
    const edit = toolOf(handle, "NovelEdit");
    await expect(
      edit.handler.execute(
        call("NovelEdit", { kind: "chapter", values: [{ id: "c1", baseRevision: 1, value: { text: "x" } }] }),
      ),
    ).rejects.toThrow(/kind=chapter 的 value 不支持字段 text/);
    await expect(
      edit.handler.execute(call("NovelEdit", { kind: "volume", values: [{ id: "v1", baseRevision: 1 }] })),
    ).rejects.toThrow(/\{ id, baseRevision, value \}/);
  });
});

describe("NovelDelete（kind 分发 + leaf 引用预检）", () => {
  it("→ mutateBatch 按 kind 展开 delete op", async () => {
    const { handle, mutateBatch } = mockHandle();
    mutateBatch.mockResolvedValue([
      { version: 3, changeId: "c1", entity: "character" },
      { version: 5, changeId: "su1", entity: "outline" },
    ]);
    const del = toolOf(handle, "NovelDelete");
    await del.handler.execute(
      call("NovelDelete", {
        values: [
          { kind: "character", id: "c1", baseRevision: 3 },
          { kind: "story_unit", id: "su1", baseRevision: 5 },
        ],
      }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "character.delete", baseRevision: 3, characterId: "c1" },
      { op: "outline.storyUnit.delete", baseRevision: 5, storyUnitId: "su1" },
    ]);
  });

  it("预检：character 被 leaf 引用 → 拒绝并列出引用单元（cascade 不豁免）", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "characters.list") return [{ id: "ch1", entityVersion: 2 }];
      if (q.op === "outline.get")
        return {
          outline: {},
          units: [
            {
              id: "su_scene",
              entityVersion: 1,
              leaf: {
                settingMode: "located",
                characters: [{ characterId: "ch1" }],
                locations: [],
                events: [],
                rhythmBeats: [],
                entityChanges: [
                  { id: "ec1", entityType: "character", entityId: "ch1", category: "condition", summary: "受伤", sourceEventIds: [] },
                ],
              },
            },
          ],
        };
      return [];
    });
    const del = toolOf(handle, "NovelDelete");
    await expect(
      del.precheck?.(
        call("NovelDelete", { cascade: true, values: [{ kind: "character", id: "ch1", baseRevision: 2 }] }),
      ),
    ).rejects.toThrow(/被 leaf 引用.*su_scene/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });

  it("预检：location 无 leaf 引用 → 放行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "locations.list") return [{ id: "loc1", entityVersion: 1 }];
      if (q.op === "outline.get") return { outline: {}, units: [] };
      return [];
    });
    const del = toolOf(handle, "NovelDelete");
    await expect(
      del.precheck?.(call("NovelDelete", { values: [{ kind: "location", id: "loc1", baseRevision: 1 }] })),
    ).resolves.toBeUndefined();
    expect(mutateBatch).not.toHaveBeenCalled();
  });
});
