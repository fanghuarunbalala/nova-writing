import { describe, it, expect, vi } from "vitest";
import {
  createCharacterTools,
  createVolumeTools,
  createDeleteTool,
  createOutlineTools,
} from "../novel.js";
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

describe("createCharacterTools", () => {
  it("Read 无 id → characters.list", async () => {
    const { handle, query } = mockHandle();
    const read = createCharacterTools(handle).find((t) => t.name === "NovelCharacterRead")!;
    await read.handler.execute(call("NovelCharacterRead", {}));
    expect(query).toHaveBeenCalledWith({ op: "characters.list" });
  });

  it("Read 有 id → characters.get", async () => {
    const { handle, query } = mockHandle();
    const read = createCharacterTools(handle).find((t) => t.name === "NovelCharacterRead")!;
    await read.handler.execute(call("NovelCharacterRead", { characterId: "c1" }));
    expect(query).toHaveBeenCalledWith({ op: "characters.get", characterId: "c1" });
  });

  it("Write → mutateBatch（character.create 逐项，id 透传）", async () => {
    const { handle, mutateBatch } = mockHandle();
    mutateBatch.mockResolvedValue([
      { version: 1, changeId: "char_x", entity: "character" },
    ]);
    const write = createCharacterTools(handle).find((t) => t.name === "NovelCharacterWrite")!;
    const result = await write.handler.execute(
      call("NovelCharacterWrite", { values: [{ name: "林默" }, { id: "hero", name: "沈砚" }] }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "character.create", id: undefined, input: { name: "林默", aliases: undefined, summary: undefined, initialState: undefined, authorNotes: undefined } },
      { op: "character.create", id: "hero", input: { name: "沈砚", aliases: undefined, summary: undefined, initialState: undefined, authorNotes: undefined } },
    ]);
    expect(JSON.parse(result)).toEqual({
      items: [{ id: "char_x", status: "applied", version: 1 }],
    });
  });

  it("Write 预检：自选 id 已占用 → duplicate_id 错误，不执行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockResolvedValue([{ id: "hero", entityVersion: 1, name: "旧角色" }]);
    const write = createCharacterTools(handle).find((t) => t.name === "NovelCharacterWrite")!;
    await expect(
      write.precheck?.(call("NovelCharacterWrite", { values: [{ id: "hero", name: "沈砚" }] })),
    ).rejects.toThrow(/duplicate_id/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });

  it("Edit → mutateBatch（character.update，{id, baseRevision, value} 形状）", async () => {
    const { handle, mutateBatch } = mockHandle();
    mutateBatch.mockResolvedValue([{ version: 4, changeId: "c1", entity: "character" }]);
    const edit = createCharacterTools(handle).find((t) => t.name === "NovelCharacterEdit")!;
    await edit.handler.execute(
      call("NovelCharacterEdit", { values: [{ id: "c1", baseRevision: 3, value: { summary: "剑客" } }] }),
    );
    expect(mutateBatch).toHaveBeenCalledWith([
      { op: "character.update", characterId: "c1", baseRevision: 3, patch: { summary: "剑客" } },
    ]);
  });

  it("Edit 预检：版本过期 → 附当前版本的错误，不执行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockResolvedValue([{ id: "c1", entityVersion: 7, name: "张三" }]);
    const edit = createCharacterTools(handle).find((t) => t.name === "NovelCharacterEdit")!;
    await expect(
      edit.precheck?.(call("NovelCharacterEdit", { values: [{ id: "c1", baseRevision: 3, value: { summary: "x" } }] })),
    ).rejects.toThrow(/当前 entityVersion 7/);
    expect(mutateBatch).not.toHaveBeenCalled();
  });
});

describe("createOutlineTools（P2 leaf/状态）", () => {
  it("Write：leaf/blockState 随创建透传", async () => {
    const { handle, mutateBatch, query } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "characters.list") return [{ id: "char_hero", entityVersion: 1 }];
      if (q.op === "outline.get") return { outline: {}, units: [] };
      return [];
    });
    mutateBatch.mockResolvedValue([{ version: 1, changeId: "su_1", entity: "outline" }]);
    const leaf = { settingMode: "located", characters: [{ characterId: "char_hero" }], locations: [], events: [], rhythmBeats: [], entityChanges: [] };
    const write = createOutlineTools(handle).find((t) => t.name === "NovelOutlineWrite")!;
    await write.handler.execute(
      call("NovelOutlineWrite", {
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

  it("Write 预检：leaf 引用不存在角色 → 拒绝，不执行", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "characters.list") return [];
      if (q.op === "outline.get") return { outline: {}, units: [] };
      return [];
    });
    const write = createOutlineTools(handle).find((t) => t.name === "NovelOutlineWrite")!;
    await expect(
      write.precheck?.(
        call("NovelOutlineWrite", {
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

  it("Read：includePlans 透传查询", async () => {
    const { handle, query } = mockHandle();
    query.mockResolvedValue({ outline: {}, units: [] });
    const read = createOutlineTools(handle).find((t) => t.name === "NovelOutlineRead")!;
    await read.handler.execute(call("NovelOutlineRead", { includePlans: true }));
    expect(query).toHaveBeenCalledWith({ op: "outline.get", includePlans: true });
    await read.handler.execute(call("NovelOutlineRead", { storyUnitId: "su_1", includePlans: true }));
    expect(query).toHaveBeenCalledWith({ op: "outline.storyUnit.get", storyUnitId: "su_1", includePlans: true });
  });

  it("Edit 预检：blockState 依赖不存在的单元 → 拒绝", async () => {
    const { handle, query, mutateBatch } = mockHandle();
    query.mockImplementation(async (q) => {
      if (q.op === "outline.get")
        return { outline: {}, units: [{ id: "su_1", entityVersion: 1 }] };
      return [];
    });
    const edit = createOutlineTools(handle).find((t) => t.name === "NovelOutlineEdit")!;
    await expect(
      edit.precheck?.(
        call("NovelOutlineEdit", {
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
});

describe("createVolumeTools / createDeleteTool（P1 legacy 对齐）", () => {
  it("VolumeRead → publication.get 投影 id/title/orderKey", async () => {
    const { handle, query } = mockHandle();
    query.mockResolvedValue({
      structure: {},
      volumes: [
        { id: "v1", title: "第一卷", orderKey: "0001", entityVersion: 2 },
      ],
      chapters: [],
    });
    const read = createVolumeTools(handle).find((t) => t.name === "NovelVolumeRead")!;
    const result = await read.handler.execute(call("NovelVolumeRead", {}));
    expect(query).toHaveBeenCalledWith({ op: "publication.get" });
    expect(JSON.parse(result)).toEqual({
      volumes: [{ id: "v1", title: "第一卷", orderKey: "0001" }],
    });
  });

  it("NovelDelete → mutateBatch 按 kind 展开 delete op", async () => {
    const { handle, mutateBatch } = mockHandle();
    mutateBatch.mockResolvedValue([
      { version: 3, changeId: "c1", entity: "character" },
      { version: 5, changeId: "su1", entity: "outline" },
    ]);
    const del = createDeleteTool(handle).find((t) => t.name === "NovelDelete")!;
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
});
