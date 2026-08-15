/**
 * P1 legacy 对齐 store 行为测试（PRD docs/PRD/novel-tools-legacy-对齐.md §4）：
 * 自选 id + duplicate_id / orderKey 末位后继 / mutateBatch 批内原子回滚 /
 * paragraphs.list 全量 / storyUnit.update parentId 移根。两个 store 同语义。
 */
import { describe, expect, it } from "vitest";
import { InMemoryNovelStore } from "../InMemoryNovelStore.js";
import { SqliteNovelStore } from "../SqliteNovelStore.js";
import { NovelDuplicateIdError } from "../errors.js";
import type { NovelStore } from "../store.js";

function makeStores(): NovelStore[] {
  return [new InMemoryNovelStore(), new SqliteNovelStore(":memory:")];
}

describe.each(makeStores())("P1 legacy 对齐 store 行为（%s）", (store) => {
  it("创建自选 id：合法即用、占用抛 duplicate_id、缺省生成", async () => {
    const r1 = await store.mutate({ op: "character.create", id: "hero-1", input: { name: "沈砚" } });
    expect(r1.changeId).toBe("hero-1");
    await expect(
      store.mutate({ op: "character.create", id: "hero-1", input: { name: "重名" } }),
    ).rejects.toBeInstanceOf(NovelDuplicateIdError);
    const r2 = await store.mutate({ op: "character.create", input: { name: "林默" } });
    expect(r2.changeId).not.toBe("hero-1");
    expect(r2.changeId.length).toBeGreaterThan(0);
  });

  it("orderKey 缺省追加末位兄弟之后（hex 4 位组，字典序递增）", async () => {
    const u1 = await store.mutate({ op: "outline.storyUnit.create", title: "卷一" });
    const u2 = await store.mutate({ op: "outline.storyUnit.create", title: "卷二" });
    const units = (await store.query({ op: "outline.get" })) as { units: { id: string; orderKey: string }[] };
    const keys = units.units
      .filter((u) => u.id === u1.changeId || u.id === u2.changeId)
      .map((u) => u.orderKey)
      .sort();
    expect(keys).toHaveLength(2);
    expect(keys[1]! > keys[0]!).toBe(true);
    expect(keys.every((k) => /^(?:[0-9A-F]{4})+$/.test(k))).toBe(true);
  });

  it("mutateBatch 批内原子：任一项失败整批回滚", async () => {
    const created = await store.mutate({ op: "character.create", input: { name: "张三" } });
    const before = (await store.query({ op: "characters.list" })) as unknown[];
    await expect(
      store.mutateBatch([
        { op: "character.create", input: { name: "李四" } },
        { op: "character.delete", characterId: created.changeId as never, baseRevision: 999 },
      ]),
    ).rejects.toThrow();
    const after = (await store.query({ op: "characters.list" })) as { name: string }[];
    expect(after).toHaveLength(before.length);
    expect(after.some((c) => c.name === "李四")).toBe(false);
  });

  it("paragraphs.list 全量（storyUnitId 缺省）与单元过滤一致", async () => {
    const su = await store.mutate({ op: "outline.storyUnit.create", title: "场景" });
    await store.mutate({ op: "paragraph.insert", storyUnitId: su.changeId as never, text: "第一段。" });
    await store.mutate({ op: "paragraph.insert", storyUnitId: su.changeId as never, text: "第二段。" });
    const all = (await store.query({ op: "paragraphs.list" })) as { text: string }[];
    const ofUnit = (await store.query({ op: "paragraphs.list", storyUnitId: su.changeId as never })) as {
      text: string;
    }[];
    expect(all).toHaveLength(2);
    expect(ofUnit.map((p) => p.text)).toEqual(["第一段。", "第二段。"]);
  });

  it("storyUnit.update patch.parentId：null 移根 / 换父", async () => {
    const parent = await store.mutate({ op: "outline.storyUnit.create", title: "父" });
    const child = await store.mutate({
      op: "outline.storyUnit.create",
      title: "子",
      parentId: parent.changeId as never,
    });
    const other = await store.mutate({ op: "outline.storyUnit.create", title: "新父" });
    await store.mutate({
      op: "outline.storyUnit.update",
      storyUnitId: child.changeId as never,
      baseRevision: 1,
      patch: { parentId: other.changeId as never },
    });
    let unit = (await store.query({ op: "outline.storyUnit.get", storyUnitId: child.changeId as never })) as {
      parentId?: string;
    };
    expect(unit.parentId).toBe(other.changeId);
    await store.mutate({
      op: "outline.storyUnit.update",
      storyUnitId: child.changeId as never,
      baseRevision: 2,
      patch: { parentId: null },
    });
    unit = (await store.query({ op: "outline.storyUnit.get", storyUnitId: child.changeId as never })) as {
      parentId?: string;
    };
    expect(unit.parentId).toBeUndefined();
  });
});
