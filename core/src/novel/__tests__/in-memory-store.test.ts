import { describe, it, expect } from "vitest";
import { InMemoryNovelStore } from "../InMemoryNovelStore.js";
import { NovelStaleRevisionError } from "../errors.js";

describe("InMemoryNovelStore", () => {
  it("character create → list/get 读回", async () => {
    const s = new InMemoryNovelStore();
    const r = await s.mutate({ op: "character.create", input: { name: "林默" } });
    const list = (await s.query({ op: "characters.list" })) as Array<{ name: string; entityVersion: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("林默");
    expect(list[0].entityVersion).toBe(1);
    const got = (await s.query({ op: "characters.get", characterId: r.changeId as never })) as { name: string };
    expect(got.name).toBe("林默");
  });

  it("character update：正确 baseRevision 成功 + entityVersion 递增", async () => {
    const s = new InMemoryNovelStore();
    const r = await s.mutate({ op: "character.create", input: { name: "林默" } });
    const r2 = await s.mutate({
      op: "character.update",
      characterId: r.changeId as never,
      baseRevision: 1,
      patch: { summary: "剑客" },
    });
    expect(r2.version).toBe(2);
    const got = (await s.query({ op: "characters.get", characterId: r.changeId as never })) as { summary?: string; entityVersion: number };
    expect(got.summary).toBe("剑客");
    expect(got.entityVersion).toBe(2);
  });

  it("character update：stale baseRevision 抛 NovelStaleRevisionError", async () => {
    const s = new InMemoryNovelStore();
    const r = await s.mutate({ op: "character.create", input: { name: "林默" } });
    // 先更新到 v2
    await s.mutate({ op: "character.update", characterId: r.changeId as never, baseRevision: 1, patch: { summary: "剑客" } });
    // 用旧 baseRevision=1 再更新 → stale
    await expect(
      s.mutate({ op: "character.update", characterId: r.changeId as never, baseRevision: 1, patch: { summary: "改" } }),
    ).rejects.toBeInstanceOf(NovelStaleRevisionError);
  });

  it("storyUnit create → outline.get 读回（含层级）", async () => {
    const s = new InMemoryNovelStore();
    await s.mutate({ op: "outline.storyUnit.create", orderKey: "a" as never, title: "第一章" });
    const snapshot = (await s.query({ op: "outline.get" })) as { units: Array<{ title: string }> };
    expect(snapshot.units).toHaveLength(1);
    expect(snapshot.units[0].title).toBe("第一章");
  });

  it("paragraph insert → paragraphs.list 按 storyUnitId 读回", async () => {
    const s = new InMemoryNovelStore();
    const su = await s.mutate({ op: "outline.storyUnit.create", orderKey: "a" as never, title: "章" });
    await s.mutate({ op: "paragraph.insert", storyUnitId: su.changeId as never, orderKey: "a" as never, text: "正文" });
    const list = (await s.query({ op: "paragraphs.list", storyUnitId: su.changeId as never })) as Array<{ text: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("正文");
  });

  it("publication volume/chapter create → publication.get 读回", async () => {
    const s = new InMemoryNovelStore();
    await s.mutate({ op: "publication.volume.create", orderKey: "a" as never, title: "第一卷" });
    await s.mutate({ op: "publication.chapter.create", orderKey: "a" as never, title: "第一章" });
    const pub = (await s.query({ op: "publication.get" })) as { volumes: Array<{ title: string }>; chapters: Array<{ title: string }> };
    expect(pub.volumes).toHaveLength(1);
    expect(pub.chapters).toHaveLength(1);
  });
});
