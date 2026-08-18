/**
 * 书库桩（F3）：LibraryReadDeps 的结构等价实现——数据全部来自静态夹具包，
 * 每次调用先经 mock 引擎决策（脚本/状态优先，miss 走静态）并记入 recorder。
 * 访问控制与护栏复刻生产语义：书单外的 bookId 不泄漏存在性（统一未授权报错）、
 * 单次 24 段上限 / 缺省 6 段、分析产物 20000 字符截断。
 */
import { InMemoryNovelStore, LibraryError } from "@novel/core";
import type { BookSummary, NovelMutation } from "@novel/core";
import { extractPids, type BookFixturePack } from "../fixture/pack.js";
import {
	LibraryCallRecorder,
	MockEngine,
	methodKind,
	type LibraryCallTrace,
	type LibraryMethod,
} from "./engine.js";

const PARAGRAPH_BATCH_DEFAULT = 6;
const PARAGRAPH_BATCH_MAX = 24;
const ANALYSIS_MAX_CHARS = 20_000;

/** 单段（与生产 readParagraphs 返回项同构） */
export interface FabricatedParagraphItem {
	id: string;
	chapterNo: number;
	chapterTitle: string;
	chars: number;
	text: string;
}

/**
 * 结构等价 LibraryReadDeps（core 未从根出口导出该接口；结构满足即可注入
 * buildNovelAgent 的 library.deps——openBookStore 以 InMemoryNovelStore 充当该书库）。
 */
export interface FabricatedLibraryDeps {
	listBooks(): Promise<BookSummary[]>;
	openBookStore(bookId: string): Promise<InMemoryNovelStore>;
	readParagraphs(
		bookId: string,
		query: {
			ids?: readonly string[];
			chapterNo?: number;
			offset?: number;
			limit?: number;
		},
	): Promise<{ items: FabricatedParagraphItem[]; total: number }>;
	readAnalysis(
		bookId: string,
		which: "style" | "excerpt",
		maxChars?: number,
	): Promise<{ content: string; truncated: boolean }>;
}

/** 构造书库桩 deps（每 run 一枚：recorder 独立、种子库懒建单例） */
export function createFabricatedLibraryDeps(
	pack: BookFixturePack,
	recorder: LibraryCallRecorder,
	mock: MockEngine = new MockEngine(),
): FabricatedLibraryDeps {
	let store: InMemoryNovelStore | undefined;

	/** 卷章骨架 + 自造实体 → 种子库（单例；形状错误在此暴露=夹具作者期 bug） */
	const ensureStore = async (): Promise<InMemoryNovelStore> => {
		if (store !== undefined) return store;
		const fresh = new InMemoryNovelStore();
		const skeleton: NovelMutation[] = [];
		for (const v of pack.book.volumes) {
			const volumeId = `${pack.alias}-vol${String(v.no).padStart(2, "0")}`;
			skeleton.push({
				op: "publication.volume.create",
				id: volumeId,
				title: v.title ?? `第${v.no}卷`,
			});
			for (const c of v.chapters) {
				skeleton.push({
					op: "publication.chapter.create",
					id: `${pack.alias}-ch${String(c.no).padStart(4, "0")}`,
					title: c.title,
					volumeId: volumeId as never,
				});
			}
		}
		try {
			await fresh.mutateBatch([...skeleton, ...pack.fabricated.entities]);
		} catch (e) {
			throw new Error(
				`夹具 ${pack.alias} 的 entities.json 落库失败：${e instanceof Error ? e.message : String(e)}`,
			);
		}
		store = fresh;
		return fresh;
	};

	/** 访问控制：声明书之外的 bookId 统一未授权（不泄漏存在性，对齐生产） */
	const auth = (bookId: string): void => {
		if (bookId !== pack.alias) {
			throw new LibraryError("LIB_BOOK_NOT_AUTHORIZED", "本书不在当前工作区书单（或不存在）");
		}
	};

	/** 统一决策 + 记录：script/state 命中 → 按响应返回或抛错；miss/exhausted → 静态路径 */
	const decide = async <T>(
		method: LibraryMethod,
		args: Record<string, unknown>,
		staticPath: () => T | Promise<T>,
	): Promise<T> => {
		const callIndex = recorder.calls.length;
		const bookId = typeof args.bookId === "string" ? args.bookId : undefined;
		const outcome = mock.resolve(method, args, callIndex);
		if (outcome.kind === "hit") {
			const { source, response } = outcome;
			if (typeof response === "string" && method !== "openBookStore") {
				recorder.record({
					callIndex,
					method,
					kind: methodKind(method, args),
					...(bookId !== undefined ? { bookId } : {}),
					args,
					source,
					returnedParagraphIds: extractPids(response, pack.alias),
				});
				return JSON.parse(response) as T;
			}
			// {error} 或 openBookStore 的字符串响应 → 错误注入
			const message = typeof response === "string" ? response : response.error;
			recorder.record({
				callIndex,
				method,
				kind: methodKind(method, args),
				...(bookId !== undefined ? { bookId } : {}),
				args,
				source,
				error: message,
			});
			throw new Error(message);
		}
		try {
			const value = await staticPath();
			const text = method === "openBookStore" ? "" : JSON.stringify(value);
			const trace: LibraryCallTrace = {
				callIndex,
				method,
				kind: methodKind(method, args),
				...(bookId !== undefined ? { bookId } : {}),
				args,
				source: "static",
				...(text !== "" ? { returnedParagraphIds: extractPids(text, pack.alias) } : {}),
			};
			recorder.record(trace);
			return value;
		} catch (e) {
			recorder.record({
				callIndex,
				method,
				kind: methodKind(method, args),
				...(bookId !== undefined ? { bookId } : {}),
				args,
				source: "static",
				error: e instanceof Error ? e.message : String(e),
			});
			throw e;
		}
	};

	return {
		listBooks: () =>
			decide("listBooks", {}, () => {
				const summary: BookSummary = {
					bookId: pack.alias,
					title: pack.title,
					sourceFile: `${pack.alias}.txt`,
					status: "已完成",
					stats: {
						volumes: pack.book.stats.volumes,
						chapters: pack.book.stats.chapters,
						batches: pack.paragraphs.length,
						chars: pack.book.stats.chars,
						// 夹具以批次为段粒度（正文不入库，对齐书库文件层语义）
						paragraphs: pack.paragraphs.length,
					},
					createdAt: pack.book.builtAt,
					updatedAt: pack.book.builtAt,
					hasStyle: pack.fabricated.style !== null,
					hasExcerpt: pack.fabricated.excerpt !== null,
				};
				return [summary];
			}),
		openBookStore: async (bookId) => {
			auth(bookId);
			return decide("openBookStore", { bookId }, () => ensureStore());
		},
		readParagraphs: async (bookId, query) => {
			auth(bookId);
			return decide("readParagraphs", { bookId, ...query }, () => {
				const filtered =
					query.ids !== undefined
						? pack.paragraphs.filter((p) => query.ids!.includes(p.id))
						: query.chapterNo !== undefined
							? pack.paragraphs.filter((p) => p.chapterNo === query.chapterNo)
							: [...pack.paragraphs];
				const offset = query.offset ?? 0;
				const limit = Math.min(query.limit ?? PARAGRAPH_BATCH_DEFAULT, PARAGRAPH_BATCH_MAX);
				return {
					items: filtered.slice(offset, offset + limit),
					total: filtered.length,
				};
			});
		},
		readAnalysis: async (bookId, which, maxChars) => {
			auth(bookId);
			return decide(
				"readAnalysis",
				{ bookId, which, ...(maxChars !== undefined ? { maxChars } : {}) },
				() => {
					const raw = which === "style" ? pack.fabricated.style : pack.fabricated.excerpt;
					if (raw === null) {
						throw new LibraryError(
							"LIB_BOOK_NOT_FOUND",
							`该书尚无${which === "style" ? "风格分析" : "特色摘录"}产物（解析未完成？）`,
						);
					}
					const cap = maxChars ?? ANALYSIS_MAX_CHARS;
					if (raw.length <= cap) return { content: raw, truncated: false };
					return {
						content: `${raw.slice(0, cap)}\n\n…（已截断，全文 ${raw.length} 字符）`,
						truncated: true,
					};
				},
			);
		},
	};
}
