/**
 * P3 发布层测试（PRD novel-tools-legacy-对齐 §4-10/11）：
 * 章段落选择（create/update 全量替换/null 清空）、存量 storyUnitId 指针一次性迁移、
 * 删除依赖检查 + 级联（单元子树/卷章/章解绑）+ deleted[] 完整记录。
 * 两个 store 同语义（每测试独立 store、唯一 id）；迁移仅 sqlite（内存无存量）。
 */
import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { InMemoryNovelStore } from "../InMemoryNovelStore.js";
import { SqliteNovelStore } from "../SqliteNovelStore.js";
import type { NovelStore } from "../store.js";

function makeStores(): NovelStore[] {
  return [new InMemoryNovelStore(), new SqliteNovelStore(":memory:")];
}

/** 每测试独立 store + 唯一 id（describe.each 共享 store 会撞 duplicate_id） */
function runBoth(fn: (store: NovelStore) => Promise<void>): Promise<void> {
  return (async () => {
    for (const store of makeStores()) await fn(store);
  })();
}

const tmpDirs: string[] = [];
afterAll(() => {
  // 尽力而为：sqlite 文件可能仍被未 close 的连接锁定（Windows EPERM），留给系统临时目录清理
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

let seedSeq = 0;

/** 备好一段场景：卷 + 章（选择 p1、p2）+ 单元（挂 p1、p2）；返回各实体 id */
async function seedSelectionScene(store: NovelStore): Promise<{
  volumeId: string;
  unitId: string;
  p1: string;
  p2: string;
  chapterId: string;
}> {
  const n = ++seedSeq;
  const volumeId = `v${n}`;
  const unitId = `su${n}`;
  const p1 = `p${n}a`;
  const p2 = `p${n}b`;
  const chapterId = `ch${n}`;
  await store.mutate({ op: "publication.volume.create", id: volumeId, title: "第一卷" });
  await store.mutate({ op: "outline.storyUnit.create", id: unitId, title: "场景" });
  await store.mutate({ op: "paragraph.insert", id: p1, storyUnitId: unitId as never, text: "第一段。" });
  await store.mutate({ op: "paragraph.insert", id: p2, storyUnitId: unitId as never, text: "第二段。" });
  await store.mutate({
    op: "publication.chapter.create",
    id: chapterId,
    volumeId: volumeId as never,
    title: "第一章",
    paragraphIds: [p1, p2] as never[],
  });
  return { volumeId, unitId, p1, p2, chapterId };
}

async function selectionOf(store: NovelStore, chapterId: string): Promise<string[]> {
  const pub = (await store.query({ op: "publication.get" })) as {
    chapters: { id: string; paragraphIds: string[] }[];
  };
  return pub.chapters.find((c) => c.id === chapterId)?.paragraphIds ?? [];
}

describe("P3 章选择与级联（两 store 同语义）", () => {
  it("章创建带选择 + 读回有序；update 全量替换 / null 清空；引用缺失拒绝", async () => {
    await runBoth(async (store) => {
      const { chapterId, p1, p2 } = await seedSelectionScene(store);
      expect(await selectionOf(store, chapterId)).toEqual([p1, p2]);

      await store.mutate({
        op: "publication.chapter.update",
        chapterId: chapterId as never,
        baseRevision: 1,
        patch: { paragraphIds: [p2, p1] as never[] },
      });
      expect(await selectionOf(store, chapterId)).toEqual([p2, p1]);

      await store.mutate({
        op: "publication.chapter.update",
        chapterId: chapterId as never,
        baseRevision: 2,
        patch: { paragraphIds: null },
      });
      expect(await selectionOf(store, chapterId)).toEqual([]);

      await expect(
        store.mutate({
          op: "publication.chapter.update",
          chapterId: chapterId as never,
          baseRevision: 3,
          patch: { paragraphIds: ["ghost"] as never[] },
        }),
      ).rejects.toThrow(/ghost/);
    });
  });

  it("章删除：默认拒绝有选择的章；cascade 解绑（段落保留）+ 返回记录", async () => {
    await runBoth(async (store) => {
      const { chapterId, unitId } = await seedSelectionScene(store);
      await expect(
        store.mutate({ op: "publication.chapter.delete", chapterId: chapterId as never, baseRevision: 1 }),
      ).rejects.toThrow(/段落选择/);
      const r = await store.mutate({
        op: "publication.chapter.delete",
        chapterId: chapterId as never,
        baseRevision: 1,
        cascade: true,
      });
      expect(r.deleted?.map((d) => d.kind)).toEqual(["chapter"]);
      const paras = (await store.query({ op: "paragraphs.list", storyUnitId: unitId as never })) as unknown[];
      expect(paras).toHaveLength(2); // 段落保留在单元下
    });
  });

  it("段落删除：同时从章选择移除 + 受影响章 entityVersion+1（选择变更反映到版本）", async () => {
    await runBoth(async (store) => {
      const { p1, p2, chapterId } = await seedSelectionScene(store);
      await store.mutate({ op: "paragraph.delete", paragraphId: p1 as never, baseRevision: 1 });
      expect(await selectionOf(store, chapterId)).toEqual([p2]);
      const pub = (await store.query({ op: "publication.get" })) as {
        chapters: { id: string; entityVersion: number }[];
      };
      expect(pub.chapters.find((c) => c.id === chapterId)?.entityVersion).toBe(2);
    });
  });

  it("章选择校验失败（ghost / 重复 id）：不消耗版本号、不留部分写", async () => {
    await runBoth(async (store) => {
      const { chapterId, p1, p2 } = await seedSelectionScene(store);
      await expect(
        store.mutate({
          op: "publication.chapter.update",
          chapterId: chapterId as never,
          baseRevision: 1,
          patch: { paragraphIds: [p1, "ghost"] as never[] },
        }),
      ).rejects.toThrow(/ghost/);
      await expect(
        store.mutate({
          op: "publication.chapter.update",
          chapterId: chapterId as never,
          baseRevision: 1,
          patch: { paragraphIds: [p1, p1] as never[] },
        }),
      ).rejects.toThrow(/重复/);
      const pub = (await store.query({ op: "publication.get" })) as {
        chapters: { id: string; entityVersion: number; paragraphIds: string[] }[];
      };
      const ch = pub.chapters.find((c) => c.id === chapterId);
      expect(ch?.entityVersion).toBe(1);
      expect(ch?.paragraphIds).toEqual([p1, p2]);
    });
  });

  it("并发批执行互不串扰：失败批回滚不吞他人已成功的写；并发两批均成功", async () => {
    await runBoth(async (store) => {
      const { unitId } = await seedSelectionScene(store);
      const n = ++seedSeq;
      // 场景一：失败批（stale/缺失项回滚）与并发裸 mutate——裸写不得被批回滚连带丢弃
      const failing = store.mutateBatch([
        { op: "paragraph.insert", id: `fa${n}`, storyUnitId: unitId as never, text: "将被回滚。" },
        { op: "paragraph.delete", paragraphId: "ghost" as never, baseRevision: 1 },
      ]);
      const concurrent = store.mutate({
        op: "paragraph.insert",
        id: `fb${n}`,
        storyUnitId: unitId as never,
        text: "并发插入。",
      });
      const [failResult, okResult] = await Promise.allSettled([failing, concurrent]);
      expect(failResult.status).toBe("rejected");
      expect(okResult.status).toBe("fulfilled");
      // 场景二：两个并发批（修复前第二个 BEGIN 报嵌套事务错）
      await Promise.all([
        store.mutateBatch([
          { op: "paragraph.insert", id: `ca${n}`, storyUnitId: unitId as never, text: "并发批一。" },
          { op: "paragraph.insert", id: `ca2${n}`, storyUnitId: unitId as never, text: "并发批一续。" },
        ]),
        store.mutateBatch([
          { op: "paragraph.insert", id: `cb${n}`, storyUnitId: unitId as never, text: "并发批二。" },
          { op: "paragraph.insert", id: `cb2${n}`, storyUnitId: unitId as never, text: "并发批二续。" },
        ]),
      ]);
      const paras = (await store.query({ op: "paragraphs.list", storyUnitId: unitId as never })) as unknown[];
      // 种子 2 + 并发裸写 1 + 两批 4；失败批的 fa 不落库
      expect(paras).toHaveLength(7);
    });
  });

  it("单元删除：默认拒绝（子单元）；cascade 删子树并返回完整记录", async () => {
    await runBoth(async (store) => {
      const { unitId } = await seedSelectionScene(store);
      const parentId = `sup${++seedSeq}`;
      await store.mutate({ op: "outline.storyUnit.create", id: parentId, title: "父" });
      await store.mutate({
        op: "outline.storyUnit.update",
        storyUnitId: unitId as never,
        baseRevision: 1,
        patch: { parentId: parentId as never },
      });
      await expect(
        store.mutate({ op: "outline.storyUnit.delete", storyUnitId: parentId as never, baseRevision: 1 }),
      ).rejects.toThrow(/子单元/);

      const r = await store.mutate({
        op: "outline.storyUnit.delete",
        storyUnitId: parentId as never,
        baseRevision: 1,
        cascade: true,
      });
      const kinds = (r.deleted ?? []).map((d) => d.kind).sort();
      expect(kinds).toEqual(["paragraph", "paragraph", "story_unit", "story_unit"]);
      const units = (await store.query({ op: "outline.get" })) as { units: { id: string }[] };
      expect(units.units.find((u) => u.id === parentId)).toBeUndefined();
      expect(units.units.find((u) => u.id === unitId)).toBeUndefined();
      const paras = (await store.query({ op: "paragraphs.list" })) as unknown[];
      expect(paras).toHaveLength(0);
    });
  });

  it("卷删除：默认拒绝含章；cascade 删章（含选择，段落保留）+ 返回记录", async () => {
    await runBoth(async (store) => {
      const { volumeId } = await seedSelectionScene(store);
      await expect(
        store.mutate({ op: "publication.volume.delete", volumeId: volumeId as never, baseRevision: 1 }),
      ).rejects.toThrow(/章/);
      const r = await store.mutate({
        op: "publication.volume.delete",
        volumeId: volumeId as never,
        baseRevision: 1,
        cascade: true,
      });
      expect((r.deleted ?? []).map((d) => d.kind).sort()).toEqual(["chapter", "volume"]);
      const paras = (await store.query({ op: "paragraphs.list" })) as unknown[];
      expect(paras).toHaveLength(2); // 段落保留
    });
  });
});

describe("P3 存量章指针一次性迁移（sqlite）", () => {
  it("chapters.story_unit_id 展开为该单元全部段落的选择，随后指针清空", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-p3-mig-"));
    tmpDirs.push(dir);
    const dbPath = join(dir, "novel.db");
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE outline (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL);
      CREATE TABLE story_units (
        id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, outline_id TEXT NOT NULL,
        parent_id TEXT, order_key TEXT NOT NULL, title TEXT NOT NULL, intent TEXT, synopsis TEXT,
        scope TEXT, planning_status TEXT NOT NULL, realization_status TEXT NOT NULL,
        block_state TEXT, abandonment TEXT
      );
      CREATE TABLE paragraphs (
        id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, story_unit_id TEXT NOT NULL,
        order_key TEXT NOT NULL, text TEXT NOT NULL
      );
      CREATE TABLE volumes (
        id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, order_key TEXT NOT NULL, title TEXT NOT NULL
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY, entity_version INTEGER NOT NULL, volume_id TEXT,
        order_key TEXT NOT NULL, title TEXT NOT NULL, story_unit_id TEXT
      );
      INSERT INTO outline VALUES ('outline_1', 'novel_1');
      INSERT INTO story_units VALUES ('su1', 1, 'outline_1', NULL, '0001', '场景', NULL, NULL, NULL, 'idea', 'pending', NULL, NULL);
      INSERT INTO paragraphs VALUES ('p1', 1, 'su1', '0001', '第一段。');
      INSERT INTO paragraphs VALUES ('p2', 1, 'su1', '0002', '第二段。');
      INSERT INTO volumes VALUES ('v1', 1, '0001', '第一卷');
      INSERT INTO chapters VALUES ('ch1', 1, 'v1', '0001', '第一章', 'su1');
    `);
    raw.close();

    const store = new SqliteNovelStore(dbPath); // 构造即迁移
    const pub = (await store.query({ op: "publication.get" })) as {
      chapters: { id: string; entityVersion: number; paragraphIds: string[]; storyUnitId?: string }[];
    };
    const ch = pub.chapters.find((c) => c.id === "ch1");
    expect(ch?.paragraphIds).toEqual(["p1", "p2"]);
    expect(ch?.storyUnitId).toBeUndefined(); // 指针已清空（防二次展开）
    expect(ch?.entityVersion).toBe(2); // 选择由指针展开为显式列表 → 版本 +1（旧 baseRevision 写入会被 stale 拦截）
  });
});
