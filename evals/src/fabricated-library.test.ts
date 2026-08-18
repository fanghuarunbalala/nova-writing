/**
 * 书库桩 + mock 引擎密闭自测（F3）：LibraryReadDeps 四方法的静态语义
 * （书单过滤/越权/翻页/截断/recorder 证据链）与 mock 三态（脚本序列/耗尽回退/
 * 错误注入/状态演化）。夹具在 tmp 内现场构建（作者文件预写，免模板）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryError } from "@novel/core";
import { buildFixturePackDir } from "./fixture/build.js";
import { loadBookFixture, type BookFixturePack } from "./fixture/pack.js";
import { createFabricatedLibraryDeps } from "./mock/fabricated-library.js";
import {
	LibraryCallRecorder,
	MockEngine,
	methodKind,
	type LibraryMockScript,
} from "./mock/engine.js";

const BOOK = [
	"第一章 甲",
	"甲一。",
	"",
	"第二章 乙",
	"乙一。",
	"",
	"第三章 丙",
	"丙一。",
].join("\n");

let root: string;
let pack: BookFixturePack;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "novel-fablib-test-"));
	const sourcePath = join(root, "book.txt");
	await writeFile(sourcePath, BOOK, "utf8");
	const dir = join(root, "bkstub");
	await mkdir(join(dir, "fabricated"), { recursive: true });
	await writeFile(
		join(dir, "fabricated", "style.md"),
		"# 风格\n- 短句（例证：bkstub-p000001）。\n",
		"utf8",
	);
	await writeFile(
		join(dir, "fabricated", "entities.json"),
		JSON.stringify({
			mutations: [
				{ op: "character.create", id: "bkstub-char-0001", input: { name: "沈砚" } },
				{ op: "outline.storyUnit.create", id: "bkstub-su-0001", title: "入镇", scope: "arc" },
			],
		}),
		"utf8",
	);
	await writeFile(join(dir, "ground-truth.json"), JSON.stringify({ schema: 1 }), "utf8");
	await buildFixturePackDir({ sourcePath, alias: "bkstub", root });
	// 删掉模板补齐的 excerpts.md，构造「excerpt 产物缺失」的夹具（测生产语义的报错路径）
	await rm(join(dir, "fabricated", "excerpts.md"), { force: true });
	pack = await loadBookFixture("bkstub", root);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true }).catch(() => {});
});

function freshDeps(mock?: LibraryMockScript) {
	const recorder = new LibraryCallRecorder();
	const engine = new MockEngine(mock);
	const deps = createFabricatedLibraryDeps(pack, recorder, engine);
	return { recorder, deps };
}

describe("书库桩静态语义", () => {
	it("listBooks：返回单书摘要（产物就绪位随 fabricated）", async () => {
		const { recorder, deps } = freshDeps();
		const books = await deps.listBooks();
		expect(books).toHaveLength(1);
		expect(books[0]!.bookId).toBe("bkstub");
		expect(books[0]!.hasStyle).toBe(true);
		expect(books[0]!.hasExcerpt).toBe(false);
		expect(recorder.calls[0]!.kind).toBe("overview");
	});

	it("openBookStore：越权 bookId 统一未授权（不泄漏存在性）；种子库含骨架+实体", async () => {
		const { deps } = freshDeps();
		await expect(deps.openBookStore("bkstub")).resolves.toBeTruthy();
		await expect(deps.openBookStore("other")).rejects.toBeInstanceOf(LibraryError);
		const store = await deps.openBookStore("bkstub");
		const characters = (await store.query({ op: "characters.list" })) as Array<{ name: string }>;
		expect(characters.some((c) => c.name === "沈砚")).toBe(true);
		const publication = (await store.query({ op: "publication.get" })) as {
			volumes: unknown[];
			chapters: unknown[];
		};
		expect(publication.volumes.length).toBe(1);
		expect(publication.chapters.length).toBe(3);
	});

	it("readParagraphs：按章过滤 + offset/limit 翻页 + limit 钳制 24 + byIds", async () => {
		const { deps } = freshDeps();
		const all = await deps.readParagraphs("bkstub", {});
		expect(all.total).toBe(3);
		expect(all.items).toHaveLength(3); // 缺省 6 上限内
		const paged = await deps.readParagraphs("bkstub", { chapterNo: 2 });
		expect(paged.total).toBe(1);
		expect(paged.items[0]!.id).toBe("bkstub-p000002");
		const clamped = await deps.readParagraphs("bkstub", { limit: 100 });
		expect(clamped.items.length).toBeLessThanOrEqual(24);
		const byIds = await deps.readParagraphs("bkstub", { ids: ["bkstub-p000003"] });
		expect(byIds.items[0]!.text).toContain("丙一");
	});

	it("readAnalysis：style 可读 + 截断格式；excerpt 缺产物按生产语义报错", async () => {
		const { deps } = freshDeps();
		const style = await deps.readAnalysis("bkstub", "style");
		expect(style.truncated).toBe(false);
		expect(style.content).toContain("短句");
		const truncated = await deps.readAnalysis("bkstub", "style", 5);
		expect(truncated.truncated).toBe(true);
		expect(truncated.content).toContain("已截断");
		await expect(deps.readAnalysis("bkstub", "excerpt")).rejects.toBeInstanceOf(LibraryError);
	});

	it("recorder：返回文本中的 pid 进证据链（returnedParagraphIds）", async () => {
		const { recorder, deps } = freshDeps();
		await deps.readAnalysis("bkstub", "style");
		const call = recorder.calls.find((c) => c.method === "readAnalysis")!;
		expect(call.returnedParagraphIds).toContain("bkstub-p000001");
	});
});

describe("mock 三态语义", () => {
	it("脚本序列：按序消耗；耗尽回退静态并计 scriptExhausted", async () => {
		const { recorder, deps } = freshDeps({
			entries: [
				{
					match: { method: "listBooks" },
					responses: [JSON.stringify([{ bookId: "bkstub", title: "脚本书名" }])],
				},
			],
		});
		const first = await deps.listBooks();
		expect(first[0]!.title).toBe("脚本书名");
		expect(recorder.calls[0]!.source).toBe("script");
		const second = await deps.listBooks(); // 耗尽 → 静态
		expect(second[0]!.title).toBe("bkstub");
		expect(recorder.calls[1]!.source).toBe("static");
	});

	it("错误注入：{error} 抛错并记录（自愈类 case 的 mock 面）", async () => {
		const { recorder, deps } = freshDeps({
			entries: [{ match: { method: "listBooks" }, responses: [{ error: "注入的失败" }] }],
		});
		await expect(deps.listBooks()).rejects.toThrow("注入的失败");
		expect(recorder.calls[0]!.error).toBe("注入的失败");
	});

	it("状态演化：TS 状态函数跨调用演化（argsSubset 匹配）", async () => {
		const { deps } = freshDeps({
			entries: [
				{
					match: { method: "readParagraphs", argsSubset: { chapterNo: 1 } },
					responses: [
						(_args, state, i) => {
							state.count = ((state.count as number | undefined) ?? 0) + 1;
							return JSON.stringify({ items: [], total: 1000 + i, tag: `n${state.count}` });
						},
					],
				},
			],
		});
		const a = await deps.readParagraphs("bkstub", { chapterNo: 1 });
		expect(a.total).toBe(1000);
		const b = await deps.readParagraphs("bkstub", { chapterNo: 1 });
		expect(b.total).toBe(1001);
		const missed = await deps.readParagraphs("bkstub", { chapterNo: 2 });
		expect(missed.total).toBe(1); // argsSubset 不匹配 → 静态
	});

	it("methodKind 派生", () => {
		expect(methodKind("listBooks", {})).toBe("overview");
		expect(methodKind("readParagraphs", {})).toBe("paragraph");
		expect(methodKind("readAnalysis", { which: "style" })).toBe("style");
		expect(methodKind("openBookStore", {})).toBe("entity");
	});
});
