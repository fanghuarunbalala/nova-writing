/**
 * P2 模型层测试（PRD novel-tools-legacy-对齐 §4-7/8/9）：
 * leaf 计划（创建随挂/补丁合并/null 清除）、includePlans 读路径 + 叶完成度 rollup、
 * blockState/abandonment 写入与 null 清除。两个 store 同语义。
 */
import { describe, expect, it } from "vitest";
import { InMemoryNovelStore } from "../InMemoryNovelStore.js";
import { SqliteNovelStore } from "../SqliteNovelStore.js";
import type { NovelStore } from "../store.js";
import type { LeafPlan, StoryUnitWithLeaf } from "../contract/snapshot.js";

function makeStores(): NovelStore[] {
  return [new InMemoryNovelStore(), new SqliteNovelStore(":memory:")];
}

const leaf: LeafPlan = {
  settingMode: "located",
  time: { description: "深夜，山门旧殿" },
  characters: [
    { characterId: "char_hero" as never, involvement: { presence: "present", roles: ["point-of-view"] } },
  ],
  locations: [{ locationId: "loc_temple" as never, involvement: { role: "primary", affected: false } }],
  events: [{ id: "ev1", orderKey: "0001", description: "发现密信" }],
  rhythmBeats: [
    { id: "beat1", orderKey: "0001", rhythm: "turn", intensity: 4, relatedEventIds: ["ev1"] },
  ],
  entityChanges: [
    { id: "chg1", entityType: "character", entityId: "char_hero", category: "knowledge", summary: "得知身世", sourceEventIds: ["ev1"] },
  ],
};

describe.each(makeStores())("P2 leaf/状态（%s）", (store) => {
  it("创建随挂 leaf + includePlans 读回（缺省不含 leaf）", async () => {
    await store.mutate({ op: "character.create", id: "char_hero", input: { name: "沈砚" } });
    await store.mutate({ op: "location.create", id: "loc_temple", input: { name: "山门旧殿" } });
    const created = await store.mutate({ op: "outline.storyUnit.create", title: "场景：密信", leaf });

    const bare = (await store.query({ op: "outline.get" })) as { units: unknown[] };
    expect((bare.units[0] as Record<string, unknown>).leaf).toBeUndefined();

    const withPlans = (await store.query({ op: "outline.get", includePlans: true })) as {
      units: StoryUnitWithLeaf[];
    };
    const unit = withPlans.units.find((u) => u.id === created.changeId)!;
    expect(unit.leaf).toEqual(leaf);
    expect(unit.progress).toMatchObject({ totalLeafCount: 1, completedLeafCount: 0, isBlocked: false });
  });

  it("leaf 补丁：字段级替换（null 清集合）+ null 清整计划", async () => {
    const created = await store.mutate({ op: "outline.storyUnit.create", title: "场景", leaf });
    await store.mutate({
      op: "outline.storyUnit.update",
      storyUnitId: created.changeId as never,
      baseRevision: 1,
      patch: {
        leaf: {
          events: [{ id: "ev2", orderKey: "0002", description: "追兵至" }],
          characters: null,
        },
      },
    });
    let unit = (await store.query({
      op: "outline.storyUnit.get",
      storyUnitId: created.changeId as never,
      includePlans: true,
    })) as StoryUnitWithLeaf;
    expect(unit.leaf?.events).toHaveLength(1);
    expect((unit.leaf?.events[0] as { id: string }).id).toBe("ev2");
    expect(unit.leaf?.characters).toEqual([]);
    expect(unit.leaf?.rhythmBeats).toEqual(leaf.rhythmBeats); // 未提供的集合保留

    await store.mutate({
      op: "outline.storyUnit.update",
      storyUnitId: created.changeId as never,
      baseRevision: 2,
      patch: { leaf: null },
    });
    unit = (await store.query({
      op: "outline.storyUnit.get",
      storyUnitId: created.changeId as never,
      includePlans: true,
    })) as StoryUnitWithLeaf;
    expect(unit.leaf).toBeUndefined();
    expect(unit.progress).toMatchObject({ totalLeafCount: 0 });
  });

  it("blockState/abandonment：创建带、patch 覆盖、null 清除；rollup 派生 blocked/abandoned", async () => {
    const created = await store.mutate({
      op: "outline.storyUnit.create",
      title: "父单元",
      blockState: { reasonCode: "dependency", dependencyIds: [], blockedAt: "2026-08-14T00:00:00Z" },
    });
    let unit = (await store.query({
      op: "outline.storyUnit.get",
      storyUnitId: created.changeId as never,
      includePlans: true,
    })) as StoryUnitWithLeaf;
    expect(unit.blockState?.reasonCode).toBe("dependency");
    expect(unit.progress).toMatchObject({ isBlocked: true, effectiveStatus: "blocked" });

    await store.mutate({
      op: "outline.storyUnit.update",
      storyUnitId: created.changeId as never,
      baseRevision: 1,
      patch: {
        blockState: null,
        abandonment: { reasonCode: "replaced", abandonedAt: "2026-08-14T01:00:00Z" },
      },
    });
    unit = (await store.query({
      op: "outline.storyUnit.get",
      storyUnitId: created.changeId as never,
      includePlans: true,
    })) as StoryUnitWithLeaf;
    expect(unit.blockState).toBeUndefined();
    expect(unit.abandonment?.reasonCode).toBe("replaced");
    expect(unit.progress).toMatchObject({ isBlocked: false, effectiveStatus: "abandoned" });
  });

  it("叶完成度 rollup：父单元聚合子树叶", async () => {
    const parent = await store.mutate({ op: "outline.storyUnit.create", title: "序列" });
    await store.mutate({
      op: "outline.storyUnit.create",
      title: "场景A",
      parentId: parent.changeId as never,
      leaf,
      realizationStatus: "completed",
    });
    await store.mutate({
      op: "outline.storyUnit.create",
      title: "场景B",
      parentId: parent.changeId as never,
      leaf,
    });
    const snap = (await store.query({ op: "outline.get", includePlans: true })) as {
      units: StoryUnitWithLeaf[];
    };
    const father = snap.units.find((u) => u.id === parent.changeId)!;
    expect(father.progress).toMatchObject({ totalLeafCount: 2, completedLeafCount: 1 });
    expect(father.progress?.effectiveStatus).toBe("in-progress");
  });
});
