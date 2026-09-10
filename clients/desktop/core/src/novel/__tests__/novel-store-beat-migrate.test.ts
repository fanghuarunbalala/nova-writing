/**
 * paragraph 节奏标注（rhythm/intensity）列迁移测试：
 * 旧库（无 beat 列）打开即 ALTER 加列，存量段落读出默认 hold/3；新写入带 beat 正常落库。
 */
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteNovelStore } from "../SqliteNovelStore.js";

const dir = mkdtempSync(join(tmpdir(), "novel-beat-migrate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 手工建无 beat 列的旧 schema 库并塞入一条存量段落 */
function buildLegacyDb(dbPath: string): void {
	const raw = new DatabaseSync(dbPath);
	try {
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
			INSERT INTO outline (id, novel_id) VALUES ('outline_1', 'novel_1');
			INSERT INTO story_units (id, entity_version, outline_id, parent_id, order_key, title, planning_status, realization_status)
				VALUES ('su1', 1, 'outline_1', NULL, '0001', '旧场景', 'ready', 'completed');
			INSERT INTO paragraphs (id, entity_version, story_unit_id, order_key, text)
				VALUES ('p1', 1, 'su1', '0001', '旧正文。');
		`);
	} finally {
		raw.close();
	}
}

describe("paragraph beat 列迁移（SqliteNovelStore）", () => {
	it("旧库打开即迁移：存量段落默认 hold/3，新写入带 beat 落库且可 PATCH", async () => {
		const dbPath = join(dir, "legacy.db");
		buildLegacyDb(dbPath);

		const store = new SqliteNovelStore(dbPath);
		const legacy = (await store.query({ op: "paragraphs.list", storyUnitId: "su1" as never })) as Array<{
			id: string;
			rhythm: string;
			intensity: number;
		}>;
		expect(legacy).toHaveLength(1);
		expect(legacy[0]!.id).toBe("p1");
		expect(legacy[0]!.rhythm).toBe("hold");
		expect(legacy[0]!.intensity).toBe(3);

		await store.mutate({ op: "paragraph.insert", storyUnitId: "su1" as never, text: "新句。", rhythm: "turn", intensity: 4 });
		await store.mutate({ op: "paragraph.update", paragraphId: "p1" as never, baseRevision: 1, rhythm: "climax", intensity: 5 });
		const after = (await store.query({ op: "paragraphs.list", storyUnitId: "su1" as never })) as Array<{
			id: string;
			rhythm: string;
			intensity: number;
		}>;
		expect(after).toHaveLength(2);
		expect(after.find((p) => p.id === "p1")).toMatchObject({ rhythm: "climax", intensity: 5 });
		expect(after.find((p) => p.id !== "p1")).toMatchObject({ rhythm: "turn", intensity: 4 });
		store.close();
	});

	it("新库直接建带 beat 列的表：写入即带标注", async () => {
		const store = new SqliteNovelStore(":memory:");
		const su = await store.mutate({ op: "outline.storyUnit.create", title: "场景" });
		await store.mutate({ op: "paragraph.insert", storyUnitId: su.changeId as never, text: "他抬头。", rhythm: "turn", intensity: 4 });
		const paras = (await store.query({ op: "paragraphs.list", storyUnitId: su.changeId as never })) as Array<{
			rhythm: string;
			intensity: number;
		}>;
		expect(paras[0]).toMatchObject({ rhythm: "turn", intensity: 4 });
		store.close();
	});
});
