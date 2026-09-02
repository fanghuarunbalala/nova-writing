/**
 * LibraryStore
 *
 * 书库域 store（完本解构，PRD library-完本解构 §3.4 / app-redesign-prd §8A）：
 * - 书单（BookSummary[]，经工作区 allowlist 过滤）+ 选中书 + 七资料位选区
 * - 每书产物分部件懒加载缓存（manifest / 幕级大纲 / 人物 / 地点 / 卷章 / 分段 / 风格 / 摘录）；
 *   状态翻转（解析中 → 已完成/失败）时该书部件缓存失效重拉
 * - 导入（pickBookFile 白名单 → importBook）与重试解析；spawn 失败/降级原因回传 UI toast
 * - 进度轮询：存在「解析中」的书时每 3s 刷新 listBooks（走读不走推）
 */
import type {
	AnalysisProgress,
	BookStatus,
	BookSummary,
	Character,
	LibraryImportResult,
	LibraryOutlineSnapshot,
	Location,
	Logger,
	NovelApiClient,
	ParagraphManifestEntry,
	ParagraphTextBatch,
	PublicationSnapshot,
} from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { WorkspaceDomainStore, type ReadyWorkspaceDomainSnapshot } from "../../../shared/state/WorkspaceDomainStore.js";

/** 资料位 tab（总览 / 大纲 / 正文〔融合卷章〕/ 人物 / 地点 / 风格 / 摘录） */
export type LibraryTab =
	| "overview"
	| "outline"
	| "manuscript"
	| "characters"
	| "locations"
	| "style"
	| "excerpt";

/** 部件种类（懒加载单位） */
export type BookPartKind =
	| "manifest"
	| "outline"
	| "characters"
	| "locations"
	| "publication"
	| "style"
	| "excerpt";

/** 分段分页（一章内翻页；单次条数护栏由服务端执行） */
export interface ParagraphPage {
	readonly offset: number;
	readonly items: readonly ParagraphTextBatch[];
	readonly total: number;
}

/** 分析产物内容（截断标记由服务端附加） */
export interface AnalysisContent {
	readonly content: string;
	readonly truncated: boolean;
}

/** 每书产物部件缓存（undefined = 未加载） */
export interface BookParts {
	readonly manifest: readonly ParagraphManifestEntry[] | undefined;
	readonly outline: LibraryOutlineSnapshot | undefined;
	readonly characters: readonly Character[] | undefined;
	readonly locations: readonly Location[] | undefined;
	readonly publication: PublicationSnapshot | undefined;
	readonly paragraphs: ReadonlyMap<number, ParagraphPage>;
	readonly style: AnalysisContent | undefined;
	readonly excerpt: AnalysisContent | undefined;
}

export interface LibrarySnapshot {
	readonly phase: "idle" | "loading" | "ready" | "error";
	readonly workspaceId: string | undefined;
	readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } | undefined;
	readonly books: readonly BookSummary[];
	readonly selectedBookId: string | undefined;
	readonly tab: LibraryTab;
	/** 正文资料位：当前章（全书连续章序） */
	readonly chapterNo: number;
	/** 正文资料位：章内页码（页大小 = LIBRARY_PAGE_SIZE） */
	readonly page: number;
	/** 大纲资料位：选中 story unit id */
	readonly unitId: string | undefined;
	/** 人物/地点资料位：选中实体 id */
	readonly charId: string | undefined;
	readonly locId: string | undefined;
	readonly parts: ReadonlyMap<string, BookParts>;
	/** 解析进度（仅含「解析中」的书；3s 轮询同帧更新） */
	readonly progress: ReadonlyMap<string, AnalysisProgress>;
	/** 加载中的部件键 `${bookId}:${kind}` */
	readonly loading: ReadonlySet<string>;
	readonly importBusy: boolean;
	/** pickBookFile 已选择的源路径（导入弹窗回显） */
	readonly importSourcePath: string | undefined;
	/** 导入弹窗开合（侧栏/空态多入口，集中于此） */
	readonly importOpen: boolean;
}

/** 正文分页页大小（服务端护栏单次默认 6、上限 24） */
export const LIBRARY_PAGE_SIZE = 6;

/** 进度轮询间隔（走读不走推：宿主 3s 轮 book.meta.json 同律） */
const POLL_INTERVAL_MS = 3000;

const EMPTY_PARTS: BookParts = Object.freeze({
	manifest: undefined,
	outline: undefined,
	characters: undefined,
	locations: undefined,
	publication: undefined,
	paragraphs: new Map<number, ParagraphPage>(),
	style: undefined,
	excerpt: undefined,
});

const EMPTY_SNAPSHOT: LibrarySnapshot = Object.freeze({
	phase: "idle",
	workspaceId: undefined,
	error: undefined,
	books: Object.freeze([]),
	selectedBookId: undefined,
	tab: "overview",
	chapterNo: 1,
	page: 0,
	unitId: undefined,
	charId: undefined,
	locId: undefined,
	parts: new Map<string, BookParts>(),
	progress: new Map<string, AnalysisProgress>(),
	loading: new Set<string>(),
	importBusy: false,
	importSourcePath: undefined,
	importOpen: false,
});

export class LibraryStore extends WorkspaceDomainStore<LibrarySnapshot> {
	private readonly api: NovelApiClient;
	private readonly logger: Logger;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	/** 书本状态翻转回调（解析完成/失败通知；构造注入，每书每翻转发一次） */
	private readonly onBookStatusChanged:
		| ((book: { bookId: string; title: string; from: BookStatus; to: BookStatus }) => void)
		| undefined;

	constructor(deps: {
		readonly api: NovelApiClient;
		readonly logger?: Logger;
		readonly onBookStatusChanged?: (book: {
			bookId: string;
			title: string;
			from: BookStatus;
			to: BookStatus;
		}) => void;
	}) {
		super(
			EMPTY_SNAPSHOT,
			Object.freeze({
				code: "library-load-failed",
				message: "书单加载失败，请重试",
				retryable: true,
			}),
		);
		this.api = deps.api;
		this.logger = (deps.logger ?? noopLogger).child({ component: "library_store" });
		this.onBookStatusChanged = deps.onBookStatusChanged;
	}

	protected override setSnapshot(next: LibrarySnapshot): void {
		super.setSnapshot(next);
		this.syncPolling();
	}

	/** 存在解析中的书 → 启动 3s 轮询（刷书单 + 拉进度）；否则停止（快照每次变更后自检） */
	private syncPolling(): void {
		const active =
			this.snapshot.phase === "ready" && this.snapshot.books.some((b) => b.status === "解析中");
		if (active && this.pollTimer === undefined) {
			this.pollTimer = setInterval(() => {
				void this.refreshBooks()
					.then(() => this.refreshProgress())
					.catch(() => {
						/* 轮询失败：下一轮重试 */
					});
			}, POLL_INTERVAL_MS);
		} else if (!active && this.pollTimer !== undefined) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	/** 停止轮询（壳卸载/测试收尾） */
	dispose(): void {
		if (this.pollTimer !== undefined) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	protected async fetchReadySnapshot(
		workspaceId: string,
		generation: number,
	): Promise<ReadyWorkspaceDomainSnapshot<LibrarySnapshot> | undefined> {
		const books = Object.freeze([...(await this.api.library.listBooks())]);
		if (this.isStaleGeneration(generation)) return undefined;
		// 重载保留选区与部件缓存（书本仍存在且状态未翻转时）；首载/切换工作区重置
		const prev = this.lastReadySnapshot !== undefined ? this.snapshot : undefined;
		const parts = new Map(prev?.parts ?? []);
		for (const [bookId] of parts) {
			if (!books.some((b) => b.bookId === bookId)) parts.delete(bookId);
		}
		const selectedBookId =
			prev?.selectedBookId !== undefined && books.some((b) => b.bookId === prev.selectedBookId)
				? prev.selectedBookId
				: books[0]?.bookId;
		const keepSelection = prev !== undefined && selectedBookId !== undefined && selectedBookId === prev.selectedBookId;
		// 进度缓存：保留仍「解析中」书的条目（重载不闪断）
		const progress = new Map<string, AnalysisProgress>();
		if (prev !== undefined) {
			for (const [bookId, p] of prev.progress) {
				if (books.some((b) => b.bookId === bookId && b.status === "解析中")) progress.set(bookId, p);
			}
		}
		return {
			phase: "ready",
			workspaceId,
			books,
			selectedBookId,
			tab: keepSelection ? prev.tab : "overview",
			chapterNo: keepSelection ? prev.chapterNo : 1,
			page: keepSelection ? prev.page : 0,
			unitId: keepSelection ? prev.unitId : undefined,
			charId: keepSelection ? prev.charId : undefined,
			locId: keepSelection ? prev.locId : undefined,
			parts,
			progress,
			loading: new Set<string>(),
			importBusy: false,
			importSourcePath: undefined,
			importOpen: false,
			error: undefined,
		};
	}

	/** 轮询/导入后刷新书单：状态翻转的书部件缓存失效（产物可能就绪）+ 翻转回调（完成/失败通知） */
	async refreshBooks(): Promise<void> {
		if (this.snapshot.phase !== "ready") return;
		const books = Object.freeze([...(await this.api.library.listBooks())]);
		if (this.snapshot.phase !== "ready") return;
		const prev = this.snapshot;
		const parts = new Map(prev.parts);
		for (const [bookId] of prev.parts) {
			const before = prev.books.find((b) => b.bookId === bookId);
			const after = books.find((b) => b.bookId === bookId);
			if (after === undefined) parts.delete(bookId);
			else if (before !== undefined && before.status !== after.status) parts.set(bookId, EMPTY_PARTS);
		}
		// 状态翻转检测（解析中 → 已完成/解析失败）：清进度缓存 + 发完成/失败通知
		const flips: Array<{ bookId: string; title: string; from: BookStatus; to: BookStatus }> = [];
		const progress = new Map(prev.progress);
		for (const after of books) {
			const before = prev.books.find((b) => b.bookId === after.bookId);
			if (before === undefined || before.status === after.status) continue;
			if (after.status !== "解析中") progress.delete(after.bookId);
			if (before.status === "解析中" && after.status !== "解析中") {
				flips.push({ bookId: after.bookId, title: after.title, from: before.status, to: after.status });
			}
		}
		const selectedBookId =
			prev.selectedBookId !== undefined && books.some((b) => b.bookId === prev.selectedBookId)
				? prev.selectedBookId
				: books[0]?.bookId;
		const selectionReset = selectedBookId !== prev.selectedBookId;
		this.setSnapshot({
			...prev,
			books,
			parts,
			progress,
			selectedBookId,
			...(selectionReset
				? { tab: "overview" as const, chapterNo: 1, page: 0, unitId: undefined, charId: undefined, locId: undefined }
				: {}),
		});
		for (const flip of flips) this.onBookStatusChanged?.(flip);
	}

	/** 拉取「解析中」书的解析进度（轮询同帧；失败静默保旧值） */
	async refreshProgress(): Promise<void> {
		if (this.snapshot.phase !== "ready") return;
		const parsing = this.snapshot.books.filter((b) => b.status === "解析中");
		if (parsing.length === 0) return;
		const entries = await Promise.all(
			parsing.map(async (book) => {
				try {
					return [book.bookId, await this.api.library.analysisProgress(book.bookId)] as const;
				} catch {
					return undefined;
				}
			}),
		);
		const next = new Map(this.snapshot.progress);
		for (const entry of entries) {
			if (entry !== undefined) next.set(entry[0], entry[1]);
		}
		if (this.snapshot.phase !== "ready") return;
		this.setSnapshot({ ...this.snapshot, progress: next });
	}

	// ── 选区动作 ──

	selectBook(bookId: string): void {
		if (!this.snapshot.books.some((b) => b.bookId === bookId)) return;
		if (bookId === this.snapshot.selectedBookId) return;
		this.setSnapshot({
			...this.snapshot,
			selectedBookId: bookId,
			tab: "overview",
			chapterNo: 1,
			page: 0,
			unitId: undefined,
			charId: undefined,
			locId: undefined,
		});
	}

	selectTab(tab: LibraryTab): void {
		if (tab === this.snapshot.tab) return;
		this.setSnapshot({ ...this.snapshot, tab });
	}

	selectChapter(chapterNo: number): void {
		if (chapterNo === this.snapshot.chapterNo) return;
		this.setSnapshot({ ...this.snapshot, chapterNo, page: 0 });
	}

	setPage(page: number): void {
		if (page < 0 || page === this.snapshot.page) return;
		this.setSnapshot({ ...this.snapshot, page });
	}

	selectUnit(unitId: string): void {
		this.setSnapshot({ ...this.snapshot, unitId });
	}

	selectCharacter(charId: string): void {
		this.setSnapshot({ ...this.snapshot, charId });
	}

	selectLocation(locId: string): void {
		this.setSnapshot({ ...this.snapshot, locId });
	}

	// ── 部件懒加载 ──

	private setLoading(key: string, on: boolean): void {
		const loading = new Set(this.snapshot.loading);
		if (on) loading.add(key);
		else loading.delete(key);
		this.setSnapshot({ ...this.snapshot, loading });
	}

	private mergePart(bookId: string, patch: Partial<BookParts>): void {
		const parts = new Map(this.snapshot.parts);
		const current = parts.get(bookId) ?? EMPTY_PARTS;
		parts.set(bookId, { ...current, ...patch });
		this.setSnapshot({ ...this.snapshot, parts });
	}

	/** 拉取并缓存部件（幂等：已缓存/加载中跳过；错误吞掉留空态，见日志） */
	async ensurePart(bookId: string, kind: BookPartKind): Promise<void> {
		const key = `${bookId}:${kind}`;
		const cached = this.snapshot.parts.get(bookId);
		if (cached !== undefined && cached[kind] !== undefined) return;
		if (this.snapshot.loading.has(key)) return;
		const generation = this.currentGeneration;
		this.setLoading(key, true);
		try {
			let patch: Partial<BookParts>;
			switch (kind) {
				case "manifest":
					patch = { manifest: Object.freeze([...(await this.api.library.readManifest(bookId))]) };
					break;
				case "outline":
					patch = { outline: await this.api.library.bookOutline(bookId) };
					break;
				case "characters":
					patch = { characters: Object.freeze([...(await this.api.library.bookCharacters(bookId))]) };
					break;
				case "locations":
					patch = { locations: Object.freeze([...(await this.api.library.bookLocations(bookId))]) };
					break;
				case "publication":
					patch = { publication: await this.api.library.bookPublication(bookId) };
					break;
				case "style":
				case "excerpt":
					patch = { [kind]: await this.api.library.readAnalysis(bookId, kind) } as Partial<BookParts>;
					break;
			}
			if (this.isStaleGeneration(generation)) return;
			this.mergePart(bookId, patch);
		} catch (err) {
			this.logger.warn("library_store.part_load_failed", {
				key,
				reason: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (!this.isStaleGeneration(generation)) this.setLoading(key, false);
		}
	}

	/** 拉取章内分段页（offset = page * LIBRARY_PAGE_SIZE） */
	async ensureParagraphs(bookId: string, chapterNo: number, page: number): Promise<void> {
		const key = `${bookId}:paragraphs`;
		const offset = Math.max(0, page) * LIBRARY_PAGE_SIZE;
		const cached = this.snapshot.parts.get(bookId)?.paragraphs.get(chapterNo);
		if (cached !== undefined && cached.offset === offset) return;
		if (this.snapshot.loading.has(key)) return;
		const generation = this.currentGeneration;
		this.setLoading(key, true);
		try {
			const result = await this.api.library.readParagraphs(bookId, {
				chapterNo,
				offset,
				limit: LIBRARY_PAGE_SIZE,
			});
			if (this.isStaleGeneration(generation)) return;
			const current = this.snapshot.parts.get(bookId) ?? EMPTY_PARTS;
			const paragraphs = new Map(current.paragraphs);
			paragraphs.set(chapterNo, {
				offset,
				items: Object.freeze([...result.items]),
				total: result.total,
			});
			this.mergePart(bookId, { paragraphs });
		} catch (err) {
			this.logger.warn("library_store.paragraphs_load_failed", {
				key,
				chapterNo,
				reason: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (!this.isStaleGeneration(generation)) this.setLoading(key, false);
		}
	}

	// ── 导入 / 重试 ──

	openImport(): void {
		this.setSnapshot({ ...this.snapshot, importOpen: true });
	}

	closeImport(): void {
		this.setSnapshot({ ...this.snapshot, importOpen: false });
	}

	/** 宿主文件选择（白名单登记在 main；取消返回 undefined 并清空已选） */
	async pickBookFile(): Promise<string | undefined> {
		const picked = await this.api.library.pickBookFile();
		this.setSnapshot({
			...this.snapshot,
			importSourcePath: picked !== null ? picked.sourcePath : undefined,
		});
		return picked !== null ? picked.sourcePath : undefined;
	}

	/** 导入（确定性解析 + 可选拉起解析会话）；成功后刷新书单并选中新书 */
	async importBook(input: {
		title?: string;
		spawnAnalysis?: boolean;
	}): Promise<LibraryImportResult> {
		const sourcePath = this.snapshot.importSourcePath;
		if (sourcePath === undefined) throw new Error("先选择源文件");
		this.setSnapshot({ ...this.snapshot, importBusy: true });
		try {
			const result = await this.api.library.importBook({
				sourcePath,
				...(input.title !== undefined && input.title.trim() !== "" ? { title: input.title.trim() } : {}),
				...(input.spawnAnalysis !== undefined ? { spawnAnalysis: input.spawnAnalysis } : {}),
			});
			await this.refreshBooks();
			if (this.snapshot.books.some((b) => b.bookId === result.bookId)) this.selectBook(result.bookId);
			// 导入即拉一次进度（解析中的书立即见进度卡；仅导入的书刷新为空、无害）
			await this.refreshProgress();
			return result;
		} finally {
			this.setSnapshot({ ...this.snapshot, importBusy: false, importSourcePath: undefined });
		}
	}

	/** 重试解析（复用确定性产物；会话不可用抛错由 UI toast） */
	async retryAnalysis(bookId: string): Promise<{ conversationId?: string; spawnSkipped?: string }> {
		const result = await this.api.library.retryAnalysis(bookId);
		await this.refreshBooks();
		return result;
	}
}
