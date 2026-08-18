/**
 * LibrarySurface 冒烟：四视图接线后的书库主区表面——subhead/七段 tab/总览时间线/
 * 空态与导入弹窗入口。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookSummary, NovelApiClient } from "@novel/core";
import { LibraryStore } from "../../src/domains/library/store/LibraryStore.js";
import { LibrarySurface } from "../../src/shell/main/LibrarySurface.js";

const BOOK: BookSummary = {
	bookId: "bk_smoke1",
	title: "雨夜刀客",
	sourceFile: "雨夜刀客.txt",
	status: "已完成",
	stats: { volumes: 0, chapters: 4, batches: 4, chars: 512, paragraphs: 26 },
	createdAt: "2026-08-17T09:00:00Z",
	updatedAt: "2026-08-17T09:05:00Z",
	hasStyle: true,
	hasExcerpt: true,
};

function makeApi(books: BookSummary[]): NovelApiClient {
	return {
		library: {
			listBooks: vi.fn(async () => books),
			readManifest: vi.fn(async () => []),
			readParagraphs: vi.fn(async () => ({ items: [], total: 0 })),
			readAnalysis: vi.fn(async () => ({ content: "## 小节\nbk_smoke1-p000001", truncated: false })),
			bookOutline: vi.fn(async () => ({ outline: { id: "o" }, units: [] })),
			bookCharacters: vi.fn(async () => []),
			bookLocations: vi.fn(async () => []),
			bookPublication: vi.fn(async () => ({ structure: { id: "s", novelId: "n" }, volumes: [], chapters: [] })),
			pickBookFile: vi.fn(async () => null),
			importBook: vi.fn(),
			retryAnalysis: vi.fn(),
		},
	} as unknown as NovelApiClient;
}

describe("LibrarySurface", () => {
	it("渲染书库表面：subhead + 七段 tab + 总览时间线", async () => {
		const store = new LibraryStore({ api: makeApi([BOOK]) });
		await store.loadWorkspace("w1");
		render(<LibrarySurface library={store} />);
		expect(screen.getByText("书库 · 雨夜刀客")).toBeInTheDocument();
		for (const name of ["总览", "大纲", "正文", "人物", "地点", "风格", "摘录"]) {
			expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
		}
		expect(screen.getByText("已导入")).toBeInTheDocument();
		expect(screen.getByText("落库中")).toBeInTheDocument();
		store.dispose();
	});

	it("解析中的书：产物资料位禁用", async () => {
		const store = new LibraryStore({
			api: makeApi([{ ...BOOK, status: "解析中", hasStyle: false, hasExcerpt: false }]),
		});
		await store.loadWorkspace("w1");
		render(<LibrarySurface library={store} />);
		const disabled = screen
			.getAllByRole("tab")
			.filter((t) => (t as HTMLButtonElement).disabled)
			.map((t) => t.textContent);
		expect(disabled).toEqual(["大纲", "人物", "地点", "风格", "摘录"]);
		expect(screen.getByText(/3s 轮询/)).toBeInTheDocument();
		store.dispose();
	});

	it("空书单：空态 + 导入入口打开弹窗", async () => {
		const store = new LibraryStore({ api: makeApi([]) });
		await store.loadWorkspace("w1");
		render(<LibrarySurface library={store} />);
		const open = screen.getAllByRole("button", { name: /导入/ })[0]!;
		await userEvent.click(open);
		// 弹窗打开：解析选项与说明出现（标题与触发按钮同名，用内容项断言）
		expect(await screen.findByText("导入并解析")).toBeInTheDocument();
		expect(screen.getByText(/编码自动探测/)).toBeInTheDocument();
		store.dispose();
	});
});
