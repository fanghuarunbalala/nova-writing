/**
 * LibraryStore 单测：加载/选区/部件懒加载缓存/导入流程/轮询收敛/状态翻转失效。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookSummary, NovelApiClient } from "@novel/core";
import { LibraryStore, LIBRARY_PAGE_SIZE } from "../../../src/domains/library/store/LibraryStore.js";

function book(partial: Partial<BookSummary> & { bookId: string }): BookSummary {
	return {
		title: partial.bookId,
		sourceFile: `${partial.bookId}.txt`,
		status: "已完成",
		stats: { volumes: 1, chapters: 2, batches: 4, chars: 1000, paragraphs: 20 },
		createdAt: "2026-08-17T09:00:00Z",
		updatedAt: "2026-08-17T09:05:00Z",
		hasStyle: true,
		hasExcerpt: true,
		...partial,
	};
}

interface FakeApiShape {
	readonly listBooks: ReturnType<typeof vi.fn>;
	readonly readManifest: ReturnType<typeof vi.fn>;
	readonly readParagraphs: ReturnType<typeof vi.fn>;
	readonly pickBookFile: ReturnType<typeof vi.fn>;
	readonly importBook: ReturnType<typeof vi.fn>;
	readonly analysisProgress: ReturnType<typeof vi.fn>;
}

function makeApi(initial: BookSummary[]): { api: NovelApiClient; fake: FakeApiShape } {
	const fake = {
		listBooks: vi.fn(async () => [...initial]),
		readManifest: vi.fn(async () => [
			{ id: `${initial[0]?.bookId ?? "bk_x"}-p000001`, chapterNo: 1, chapterTitle: "第一章", chars: 100, file: "paragraphs/a.md" },
			{ id: `${initial[0]?.bookId ?? "bk_x"}-p000002`, chapterNo: 1, chapterTitle: "第一章", chars: 100, file: "paragraphs/b.md" },
		]),
		readParagraphs: vi.fn(async () => ({
			items: [
				{ id: `${initial[0]?.bookId ?? "bk_x"}-p000001`, chapterNo: 1, chapterTitle: "第一章", chars: 100, file: "paragraphs/a.md", text: "夜雨敲窗。" },
			],
			total: 1,
		})),
		pickBookFile: vi.fn(async () => ({ sourcePath: "D:\\books\\样例.txt" })),
		importBook: vi.fn(async () => ({ bookId: "bk_new01", bookDir: "bk_new01", stats: { volumes: 1, chapters: 3, batches: 3, chars: 900, paragraphs: 9 }, conversationId: "conv_9" })),
		analysisProgress: vi.fn(async (bookId: string) => ({
			status: "解析中" as const,
			totalBatches: 10,
			coveredBatches: 4,
			percent: 40,
			indeterminate: false,
			unitCount: 3,
			bookId,
		})),
	};
	return { api: { library: fake } as unknown as NovelApiClient, fake };
}

describe("LibraryStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("loadWorkspace：书单就绪 + 默认选中第一本 + 资料位总览", async () => {
		const { api } = makeApi([book({ bookId: "bk_a" }), book({ bookId: "bk_b" })]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		const s = store.getSnapshot();
		expect(s.phase).toBe("ready");
		expect(s.books.map((b) => b.bookId)).toEqual(["bk_a", "bk_b"]);
		expect(s.selectedBookId).toBe("bk_a");
		expect(s.tab).toBe("overview");
		store.dispose();
	});

	it("选区动作：selectBook 重置；selectChapter/setPage 生效", async () => {
		const { api } = makeApi([book({ bookId: "bk_a" }), book({ bookId: "bk_b" })]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		store.selectTab("manuscript");
		store.selectChapter(2);
		store.setPage(1);
		store.selectBook("bk_b");
		let s = store.getSnapshot();
		expect(s.tab).toBe("overview");
		expect(s.chapterNo).toBe(1);
		expect(s.page).toBe(0);
		store.selectChapter(2);
		store.setPage(1);
		s = store.getSnapshot();
		expect(s.chapterNo).toBe(2);
		expect(s.page).toBe(1);
		store.dispose();
	});

	it("ensurePart 幂等缓存 + readParagraphs 护栏参数", async () => {
		const { api, fake } = makeApi([book({ bookId: "bk_a" })]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		await store.ensurePart("bk_a", "manifest");
		await store.ensurePart("bk_a", "manifest");
		expect(fake.readManifest).toHaveBeenCalledTimes(1);
		await store.ensureParagraphs("bk_a", 1, 0);
		await store.ensureParagraphs("bk_a", 1, 0);
		expect(fake.readParagraphs).toHaveBeenCalledTimes(1);
		expect(fake.readParagraphs).toHaveBeenCalledWith("bk_a", { chapterNo: 1, offset: 0, limit: LIBRARY_PAGE_SIZE });
		expect(store.getSnapshot().parts.get("bk_a")?.manifest).toHaveLength(2);
		store.dispose();
	});

	it("导入流程：pick → import → 刷新选中新书", async () => {
		const books = [book({ bookId: "bk_a" })];
		const { api, fake } = makeApi(books);
		fake.listBooks.mockImplementation(async () => [...books]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		const picked = await store.pickBookFile();
		expect(picked).toBe("D:\\books\\样例.txt");
		books.unshift(book({ bookId: "bk_new01", status: "解析中", hasStyle: false, hasExcerpt: false }));
		const result = await store.importBook({ spawnAnalysis: true });
		expect(result.conversationId).toBe("conv_9");
		const s = store.getSnapshot();
		expect(s.selectedBookId).toBe("bk_new01");
		expect(s.importBusy).toBe(false);
		expect(s.importSourcePath).toBeUndefined();
		store.dispose();
	});

	it("轮询：存在解析中的书时每 3s 刷新；完成后停止", async () => {
		let books = [book({ bookId: "bk_run", status: "解析中", hasStyle: false, hasExcerpt: false })];
		const { api, fake } = makeApi(books);
		fake.listBooks.mockImplementation(async () => [...books]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		expect(fake.listBooks).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(3100);
		expect(fake.listBooks.mock.calls.length).toBeGreaterThanOrEqual(2);
		// 完成翻转 → 下一轮后停止
		books = [book({ bookId: "bk_run" })];
		const callsAfterFlip = fake.listBooks.mock.calls.length;
		await vi.advanceTimersByTimeAsync(3100);
		expect(fake.listBooks.mock.calls.length).toBe(callsAfterFlip + 1);
		await vi.advanceTimersByTimeAsync(7000);
		expect(fake.listBooks.mock.calls.length).toBe(callsAfterFlip + 1);
		store.dispose();
	});

	it("状态翻转：refreshBooks 清空该书部件缓存", async () => {
		let books = [book({ bookId: "bk_a", status: "解析中", hasStyle: false, hasExcerpt: false })];
		const { api, fake } = makeApi(books);
		fake.listBooks.mockImplementation(async () => [...books]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		await store.ensurePart("bk_a", "manifest");
		expect(store.getSnapshot().parts.get("bk_a")?.manifest).toBeDefined();
		books = [book({ bookId: "bk_a" })];
		await store.refreshBooks();
		expect(store.getSnapshot().parts.get("bk_a")?.manifest).toBeUndefined();
		store.dispose();
	});

	it("进度轮询：解析中的书拉 analysisProgress 入快照", async () => {
		const books = [book({ bookId: "bk_run", status: "解析中", hasStyle: false, hasExcerpt: false })];
		const { api, fake } = makeApi(books);
		fake.listBooks.mockImplementation(async () => [...books]);
		const store = new LibraryStore({ api });
		await store.loadWorkspace("w1");
		await vi.advanceTimersByTimeAsync(3100);
		const progress = store.getSnapshot().progress.get("bk_run");
		expect(progress).toBeDefined();
		expect(progress?.percent).toBe(40);
		expect(progress?.coveredBatches).toBe(4);
		store.dispose();
	});

	it("状态翻转通知：解析中→已完成 恰发一次回调 + 清进度缓存", async () => {
		let books = [book({ bookId: "bk_run", title: "样例书", status: "解析中", hasStyle: false, hasExcerpt: false })];
		const { api, fake } = makeApi(books);
		fake.listBooks.mockImplementation(async () => [...books]);
		const flips: Array<{ bookId: string; title: string; from: string; to: string }> = [];
		const store = new LibraryStore({
			api,
			onBookStatusChanged: (flip) => flips.push(flip),
		});
		await store.loadWorkspace("w1");
		await vi.advanceTimersByTimeAsync(3100);
		expect(store.getSnapshot().progress.get("bk_run")).toBeDefined();
		// 翻转为已完成
		books = [book({ bookId: "bk_run", title: "样例书" })];
		await vi.advanceTimersByTimeAsync(3100);
		expect(flips).toHaveLength(1);
		expect(flips[0]).toMatchObject({ bookId: "bk_run", title: "样例书", from: "解析中", to: "已完成" });
		// 进度缓存清空；后续轮询停止不再触发
		expect(store.getSnapshot().progress.get("bk_run")).toBeUndefined();
		await vi.advanceTimersByTimeAsync(7000);
		expect(flips).toHaveLength(1);
		store.dispose();
	});

	it("翻转回调不发：非解析中起点（重试场景 from=解析失败 不通知）", async () => {
		let books = [book({ bookId: "bk_bad", status: "解析失败" })];
		const { api, fake } = makeApi(books);
		fake.listBooks.mockImplementation(async () => [...books]);
		const flips: unknown[] = [];
		const store = new LibraryStore({ api, onBookStatusChanged: (f) => flips.push(f) });
		await store.loadWorkspace("w1");
		books = [book({ bookId: "bk_bad", status: "解析中", hasStyle: false, hasExcerpt: false })];
		await store.refreshBooks();
		books = [book({ bookId: "bk_bad" })];
		await store.refreshBooks();
		// 解析失败 → 解析中 → 已完成：只有 解析中→已完成 这一次翻转发通知
		expect(flips).toHaveLength(1);
		expect(flips[0]).toMatchObject({ from: "解析中", to: "已完成" });
		store.dispose();
	});
});
