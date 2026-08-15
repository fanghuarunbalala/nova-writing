import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SqliteNovelStore } from "../SqliteNovelStore.js";
import { NovelStaleRevisionError } from "../errors.js";

describe("SqliteNovelStore", () => {
	it("character.create → characters.list 落盘", async () => {
		const store = new SqliteNovelStore(":memory:");
		await store.mutate({ op: "character.create", input: { name: "张三" } });
		const characters = (await store.query({ op: "characters.list" })) as { name: string }[];
		expect(characters).toHaveLength(1);
		expect(characters[0].name).toBe("张三");
	});

	it("update 乐观锁：stale baseRevision 抛 NovelStaleRevisionError", async () => {
		const store = new SqliteNovelStore(":memory:");
		const created = await store.mutate({ op: "character.create", input: { name: "张三" } });
		await expect(
			store.mutate({ op: "character.update", characterId: created.changeId, baseRevision: 99, patch: { name: "李四" } }),
		).rejects.toBeInstanceOf(NovelStaleRevisionError);
	});

	it("storyUnit.create → outline.get 返回树", async () => {
		const store = new SqliteNovelStore(":memory:");
		await store.mutate({ op: "outline.storyUnit.create", orderKey: "a", title: "第一章" });
		const outline = (await store.query({ op: "outline.get" })) as { units: { title: string }[] };
		expect(outline.units).toHaveLength(1);
		expect(outline.units[0].title).toBe("第一章");
	});

	it("close 后同路径新实例可读写（workspace 切换热重绑）", async () => {
		const dbPath = join(tmpdir(), `novel-store-close-${randomUUID()}.db`);
		const first = new SqliteNovelStore(dbPath);
		await first.mutate({ op: "character.create", input: { name: "张三" } });
		first.close();

		const second = new SqliteNovelStore(dbPath);
		const characters = (await second.query({ op: "characters.list" })) as { name: string }[];
		expect(characters.map((c) => c.name)).toEqual(["张三"]);
		second.close();
		rmSync(dbPath, { force: true });
	});
});
