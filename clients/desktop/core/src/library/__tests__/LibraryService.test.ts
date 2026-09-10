import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryService, LibraryError } from "../LibraryService.js";

/** 造临时目录 */
function tmpRoot(): string {
	const dir = join(tmpdir(), `library-service-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** 样例书（两卷三章，每章一批以内） */
function sampleBook(): string {
	const prose = (n: number): string =>
		Array.from({ length: n }, (_, i) => `第${i}句：夜雨敲窗，他握刀立于巷口，听见熟悉的脚步声由远及近。`).join("\n\n");
	return [
		"第一卷 少年",
		"第一章 出门",
		prose(10),
		"第二章 行路",
		prose(10),
		"第二卷 江湖",
		"第三章 入局",
		prose(10),
	].join("\n");
}

/** 写样例源文件并返回路径 */
function writeSample(root: string): string {
	const path = join(root, "样例书.txt");
	writeFileSync(path, sampleBook(), "utf8");
	return path;
}

describe("LibraryService", () => {
	it("importBook：目录布局 + manifest + 卷章发布骨架入库（无大纲/无段落实体）", async () => {
		const root = tmpRoot();
		try {
			const service = new LibraryService({ libraryRoot: root });
			const result = await service.importBook({
				sourcePath: writeSample(root),
				bookId: "bk_test01",
			});
			expect(result.bookId).toBe("bk_test01");

			// 目录布局
			const dir = join(root, "bk_test01");
			expect(existsSync(join(dir, "book.meta.json"))).toBe(true);
			expect(existsSync(join(dir, "book.db"))).toBe(true);
			expect(existsSync(join(dir, "source", "样例书.txt"))).toBe(true);
			expect(existsSync(join(dir, "paragraphs", "manifest.jsonl"))).toBe(true);

			// manifest：id 方案 + 章归属
			const manifest = readFileSync(join(dir, "paragraphs", "manifest.jsonl"), "utf8")
				.split(/\r?\n/)
				.filter((l) => l.trim().length > 0)
				.map((l) => JSON.parse(l) as { id: string; chapterNo: number });
			expect(manifest.length).toBe(3);
			expect(manifest[0].id).toBe("bk_test01-p000001");
			expect(manifest.map((e) => e.chapterNo)).toEqual([1, 2, 3]);
			for (const entry of manifest) {
				expect(existsSync(join(dir, entry.file))).toBe(true);
			}

			// db：两卷三章骨架，paragraphIds 空，无 story unit / paragraph 实体
			const { SqliteNovelStore } = await import("../../novel/SqliteNovelStore.js");
			const store = new SqliteNovelStore(join(dir, "book.db"), { readOnly: true });
			const publication = (await store.query({ op: "publication.get" })) as {
				volumes: { id: string; title: string }[];
				chapters: { id: string; title: string; volumeId?: string }[];
			};
			const outline = (await store.query({ op: "outline.get" })) as { units: unknown[] };
			const paragraphs = (await store.query({ op: "paragraphs.list" })) as unknown[];
			store.close();
			const volumes = publication.volumes;
			const chapters = publication.chapters;
			expect(volumes.map((v) => v.id)).toEqual(["bk_test01-vol01", "bk_test01-vol02"]);
			expect(chapters.map((c) => c.id)).toEqual([
				"bk_test01-ch0001",
				"bk_test01-ch0002",
				"bk_test01-ch0003",
			]);
			expect(chapters[0].volumeId).toBe("bk_test01-vol01");
			expect(chapters[2].volumeId).toBe("bk_test01-vol02");
			expect(outline.units).toHaveLength(0);
			expect(paragraphs).toHaveLength(0);

			// meta
			const meta = await service.readMeta("bk_test01");
			expect(meta.status).toBe("解析中");
			expect(meta.stats.chapters).toBe(3);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("readParagraphs：按章批量 / 按 id 精确 + 条数护栏", async () => {
		const root = tmpRoot();
		try {
			const service = new LibraryService({ libraryRoot: root });
			await service.importBook({ sourcePath: writeSample(root), bookId: "bk_test02" });
			const byChapter = await service.readParagraphs("bk_test02", { chapterNo: 2 });
			expect(byChapter.total).toBe(1);
			expect(byChapter.items[0].text).toContain("第0句");
			const byIds = await service.readParagraphs("bk_test02", {
				ids: ["bk_test02-p000001", "bk_test02-p000003"],
			});
			expect(byIds.items).toHaveLength(2);
			const capped = await service.readParagraphs("bk_test02", { limit: 999 });
			expect(capped.items.length).toBeLessThanOrEqual(24);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("工作区书单：默认无访问；授权后可见；未授权读取拒绝且不泄漏存在性", async () => {
		const root = tmpRoot();
		const ws = join(root, "ws");
		try {
			mkdirSync(ws, { recursive: true });
			const service = new LibraryService({ libraryRoot: root, workspaceRoot: ws });
			await service.importBook({ sourcePath: writeSample(root), bookId: "bk_test03" });

			// 默认（无书单）：overview 空、读取拒绝
			expect(await service.listBooks()).toHaveLength(0);
			await expect(service.readManifest("bk_test03")).rejects.toMatchObject({
				code: "LIB_BOOK_NOT_AUTHORIZED",
			});

			// 授权：overview 列出、读取放行
			mkdirSync(join(ws, ".novel"), { recursive: true });
			writeFileSync(
				join(ws, ".novel", "library.json"),
				JSON.stringify({ books: ["bk_test03"] }),
				"utf8",
			);
			const books = await service.listBooks();
			expect(books).toHaveLength(1);
			expect(books[0].bookId).toBe("bk_test03");
			expect(books[0].hasStyle).toBe(false);
			expect(await service.readManifest("bk_test03")).toHaveLength(3);

			// 未授权的书与不存在的书：同错误码同语义（不泄漏存在性）
			await service.importBook({ sourcePath: writeSample(root), bookId: "bk_test04" });
			const denied = service.readManifest("bk_test04");
			const missing = service.readManifest("bk_nope");
			await expect(denied).rejects.toMatchObject({ code: "LIB_BOOK_NOT_AUTHORIZED" });
			await expect(missing).rejects.toMatchObject({ code: "LIB_BOOK_NOT_AUTHORIZED" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("readAnalysis：缺产物报错；有产物受长度护栏", async () => {
		const root = tmpRoot();
		try {
			const service = new LibraryService({ libraryRoot: root });
			await service.importBook({ sourcePath: writeSample(root), bookId: "bk_test05" });
			await expect(service.readAnalysis("bk_test05", "style")).rejects.toBeInstanceOf(LibraryError);
			mkdirSync(join(root, "bk_test05", "analysis"), { recursive: true });
			writeFileSync(
				join(root, "bk_test05", "analysis", "style.md"),
				"风".repeat(30000),
				"utf8",
			);
			const result = await service.readAnalysis("bk_test05", "style");
			expect(result.truncated).toBe(true);
			expect(result.content.length).toBeLessThan(21000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("searchHighlights：缺库报错；tag any/all 过滤 + limit 护栏 + 脏行跳过", async () => {
		const root = tmpRoot();
		try {
			const service = new LibraryService({ libraryRoot: root });
			await service.importBook({ sourcePath: writeSample(root), bookId: "bk_test06" });
			await expect(service.searchHighlights("bk_test06")).rejects.toMatchObject({
				code: "LIB_BOOK_NOT_FOUND",
			});
			mkdirSync(join(root, "bk_test06", "analysis"), { recursive: true });
			const entries = [
				{ paragraphId: "bk_test06-p000001", tags: ["动作", "紧张"], text: "刀出鞘。", note: "单句成段" },
				{ paragraphId: "bk_test06-p000002", tags: ["对话", "幽默"], text: "「走路是养生。」" },
				{ paragraphId: "bk_test06-p000003", tags: ["动作", "幽默"], text: "他撞上了门框。" },
			];
			writeFileSync(
				join(root, "bk_test06", "analysis", "highlights.jsonl"),
				[...entries.map((e) => JSON.stringify(e)), "不是json", ""].join("\n"),
				"utf8",
			);
			// 不带 tags：全量（脏行被跳过）
			const all = await service.searchHighlights("bk_test06");
			expect(all.items).toHaveLength(3);
			expect(all.truncated).toBe(false);
			// any：命中任一
			const any = await service.searchHighlights("bk_test06", { tags: ["紧张"] });
			expect(any.items.map((e) => e.paragraphId)).toEqual(["bk_test06-p000001"]);
			// all：全部命中
			const both = await service.searchHighlights("bk_test06", { tags: ["动作", "幽默"], mode: "all" });
			expect(both.items.map((e) => e.paragraphId)).toEqual(["bk_test06-p000003"]);
			// limit：截断标记
			const limited = await service.searchHighlights("bk_test06", { limit: 2 });
			expect(limited.items).toHaveLength(2);
			expect(limited.total).toBe(3);
			expect(limited.truncated).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("analysisProgress：outline 覆盖推导——无 scene indeterminate；有引用取 maxSeq；未授权拒绝", async () => {
		const root = tmpRoot();
		try {
			const service = new LibraryService({ libraryRoot: root });
			// 大样例（每章 ~10 批，全书 ~30 批——maxSeq=5 不触顶）
			const prose = (n: number): string =>
				Array.from({ length: n }, (_, i) => `第${i}句：夜雨敲窗，他握刀立于巷口，听见熟悉的脚步声由远及近，又缓缓远去。`).join("\n\n");
			const sourcePath = join(root, "大样例.txt");
			writeFileSync(sourcePath, ["第一章 出门", prose(320), "第二章 行路", prose(320), "第三章 入局", prose(320)].join("\n"), "utf8");
			await service.importBook({ sourcePath, bookId: "bk_test07" });
			// 未建任何 scene：indeterminate
			const empty = await service.analysisProgress("bk_test07");
			expect(empty.indeterminate).toBe(true);
			expect(empty.percent).toBe(0);
			expect(empty.totalBatches).toBeGreaterThan(0);
			expect(empty.unitCount).toBe(0);
			// 建 saga + 两个 scene（synopsis 引用分段 id，非连续取最大）
			const store = await service.openBookStore("bk_test07", { readOnly: false });
			await store.mutateBatch([
				{ op: "outline.storyUnit.create", id: "bk_test07-su-0001", title: "总纲" },
				{
					op: "outline.storyUnit.create",
					id: "bk_test07-scn-0001",
					parentId: "bk_test07-su-0001",
					title: "苏醒",
					synopsis: "覆盖 bk_test07-p000001 至 p000002。",
				},
				{
					op: "outline.storyUnit.create",
					id: "bk_test07-scn-0002",
					parentId: "bk_test07-su-0001",
					title: "出门",
					synopsis: "读到 bk_test07-p000005（出门段）。",
				},
			] as never);
			store.close();
			const progress = await service.analysisProgress("bk_test07");
			expect(progress.indeterminate).toBe(false);
			expect(progress.coveredBatches).toBe(5);
			expect(progress.unitCount).toBe(3);
			expect(progress.percent).toBe(Math.round((5 / progress.totalBatches) * 100));
			// journal 信号：outline 无 id 时从解析会话 journal 的 Read 调用取最大序（读取游标领先写入）
			const journalPath = join(root, "journal-fake.jsonl");
			writeFileSync(
				journalPath,
				[
					'{"seq":1,"kind":"append","messages":[{"role":"assistant","toolCalls":[{"id":"c1","name":"Read","args":"{\\"file_path\\": \\"bk_test07/paragraphs/bk_test07-p000006.md\\"}"}]}]}',
					'{"seq":2,"kind":"append","messages":[{"role":"assistant","toolCalls":[{"id":"c2","name":"Read","args":"{\\"file_path\\": \\"bk_test07/paragraphs/bk_test07-p000010.md\\"}"}]}]}',
				].join("\n"),
				"utf8",
			);
			const viaJournal = await service.analysisProgress("bk_test07", journalPath);
			expect(viaJournal.indeterminate).toBe(false);
			// journal 读取游标（10）领先 outline 写入信号（5），取最大
			expect(viaJournal.coveredBatches).toBe(10);
			expect(viaJournal.percent).toBe(Math.round((10 / viaJournal.totalBatches) * 100));
			// 不存在的 journal 路径：静默降级回 outline 信号
			const degraded = await service.analysisProgress("bk_test07", join(root, "nope.jsonl"));
			expect(degraded.coveredBatches).toBe(5);
			// 书单外（带 workspaceRoot 的服务）：未授权统一拒绝
			const gated = new LibraryService({ libraryRoot: root, workspaceRoot: root });
			await expect(gated.analysisProgress("bk_test07")).rejects.toMatchObject({
				code: "LIB_BOOK_NOT_AUTHORIZED",
			});
			// 释放只读句柄（Windows 下未关会锁 db 文件，临时目录删不掉）
			service.close();
			gated.close();
		} finally {
			// Windows 下 WAL/SHM 句柄释放有延迟：删除带重试
			for (let i = 0; i < 5; i += 1) {
				try {
					rmSync(root, { recursive: true, force: true });
					break;
				} catch {
					await new Promise((r) => setTimeout(r, 50));
				}
			}
		}
	});

	it("导入失败回滚（非法编码路径不留半截目录）", async () => {
		const root = tmpRoot();
		try {
			const service = new LibraryService({ libraryRoot: root });
			// 二进制内容（含非法 UTF-8 序列且无中文编码可解）——构造不可解码 buffer
			const badPath = join(root, "bad.bin");
			writeFileSync(badPath, Buffer.from([0xff, 0xfe, 0x00, 0xd8, 0x00, 0x00, 0xff, 0xff]));
			// GB18030 对多数字节序列可解，改用「空正文」路径验证回滚
			writeFileSync(join(root, "empty.txt"), "   \n\n", "utf8");
			await expect(
				service.importBook({ sourcePath: join(root, "empty.txt"), bookId: "bk_test06" }),
			).rejects.toMatchObject({ code: "LIB_IMPORT_FAILED" });
			expect(existsSync(join(root, "bk_test06"))).toBe(false);
			void badPath;
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
