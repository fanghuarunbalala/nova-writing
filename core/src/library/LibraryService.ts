/**
 * LibraryService：书库唯一门面（PRD library-完本解构 F9）——读取/导出的全部
 * 存储与访问细节（每书 book.db、paragraphs 分批文件、manifest、工作区书单）
 * 封装于服务内部；上层（LibraryRead 工具、evals Runner、后续 GUI）仅依赖本接口。
 * 经组合持有各依赖（store 句柄 + 文件访问 + 书单读取），不使用继承链。
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { SqliteNovelStore } from "../novel/SqliteNovelStore.js";
import type { NovelStore } from "../novel/store.js";
import type { NovelMutation } from "../novel/contract/mutation.js";
import type { PublicationVolumeId } from "../novel/model/id.js";
import { parseBookText } from "./BookTextParser.js";
import { readLibraryAllowlist } from "./LibraryAccessPolicy.js";
import {
	analysisFilePath,
	bookDbPath,
	bookDir,
	bookManifestPath,
	bookMetaPath,
	bookParagraphsDir,
	bookSourceDir,
	highlightsFilePath,
	isValidBookId,
	nextBookId,
	paragraphFilePath,
	paragraphIdOf,
} from "./LibraryPaths.js";

/** 书本解析状态（book.meta.json.status；解析中由 Agent 收尾置已完成/解析失败） */
export type BookStatus = "解析中" | "已完成" | "解析失败";

/** 分段索引条目（manifest.jsonl 每行） */
export interface ParagraphManifestEntry {
	/** 分段 id（`<bookId>-p<6位序>`，全库唯一） */
	readonly id: string;
	/** 章序（全书连续） */
	readonly chapterNo: number;
	/** 章标题 */
	readonly chapterTitle: string;
	/** 该批字符数 */
	readonly chars: number;
	/** 批文件（书目录内相对路径，如 `paragraphs/<id>.md`） */
	readonly file: string;
}

/** 好句好段条目（analysis/highlights.jsonl 每行；tag 召回范句库） */
export interface HighlightEntry {
	/** 源分段 id（完整形式 `<bookId>-p<6位序>`，manifest 可查） */
	readonly paragraphId: string;
	/** 关键字（多个；覆盖技法与情绪/场景两个维度） */
	readonly tags: readonly string[];
	/** 受控摘录（≤200 字） */
	readonly text: string;
	/** 为什么好 / 什么写作场景可借鉴 */
	readonly note?: string;
}

/** 解析进度（outline 覆盖推导；GUI 3s 轮询读面） */
export interface AnalysisProgress {
	/** 当前状态（meta.status） */
	readonly status: BookStatus;
	/** 全书分段总数（manifest 条数） */
	readonly totalBatches: number;
	/** 已覆盖分段序（scene synopsis 引用 id 的最大序号——顺序解析的读取游标） */
	readonly coveredBatches: number;
	/** 百分比 0–100（indeterminate 时 0） */
	readonly percent: number;
	/** 无任何 scene 引用（导入完成/大纲未开建，进度不可定） */
	readonly indeterminate: boolean;
	/** 已建 story unit 数（供进度卡展示） */
	readonly unitCount: number;
}

/** 书元数据（book.meta.json） */
export interface BookMeta {
	/** 书 id */
	readonly bookId: string;
	/** 书名（导入时可指定；缺省取源文件名去扩展） */
	readonly title: string;
	/** 源文件名（source/ 内） */
	readonly sourceFile: string;
	/** 解析状态 */
	readonly status: BookStatus;
	/** 状态说明（失败原因等；缺省无） */
	readonly statusReason?: string;
	/** 统计 */
	readonly stats: {
		readonly volumes: number;
		readonly chapters: number;
		readonly batches: number;
		readonly chars: number;
		readonly paragraphs: number;
	};
	/** 创建时间（ISO） */
	readonly createdAt: string;
	/** 更新时间（ISO） */
	readonly updatedAt: string;
}

/** 书目摘要（overview 返回；含产物就绪位） */
export interface BookSummary extends BookMeta {
	/** 风格 md 是否已产出 */
	readonly hasStyle: boolean;
	/** 特色摘录是否已产出 */
	readonly hasExcerpt: boolean;
}

/** 导入结果 */
export interface ImportBookResult {
	/** 书 id */
	readonly bookId: string;
	/** 书目录（书库根相对 = bookId） */
	readonly bookDir: string;
	/** 统计 */
	readonly stats: BookMeta["stats"];
}

/** 书库服务构造选项 */
export interface LibraryServiceOptions {
	/** 书库根目录（全局，跨工作区共享） */
	readonly libraryRoot: string;
	/** 工作区根（读路径访问控制：给定后 bookId 级读取按书单过滤；导入写路径不设） */
	readonly workspaceRoot?: string;
}

/** 源文件大小上限（20 MiB） */
const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** 单次分段读取默认条数（token 护栏） */
const PARAGRAPH_BATCH_DEFAULT = 6;

/** 单次分段读取最大条数（token 护栏硬上限） */
const PARAGRAPH_BATCH_MAX = 24;

/** 分析产物单次返回字符上限（截断标记附加） */
const ANALYSIS_MAX_CHARS = 20_000;

/** 好句好段召回默认条数（token 护栏） */
const HIGHLIGHTS_DEFAULT_LIMIT = 20;

/** 好句好段召回最大条数（token 护栏硬上限） */
const HIGHLIGHTS_MAX_LIMIT = 50;

/** chapter.create 批量分片（单事务上限，防超大书单批过大） */
const MUTATE_CHUNK = 200;

/** 书库错误码 */
export type LibraryErrorCode =
	| "LIB_BOOK_NOT_FOUND"
	| "LIB_BOOK_NOT_AUTHORIZED"
	| "LIB_INVALID_ARGUMENT"
	| "LIB_IMPORT_FAILED";

/** 书库错误（code 供上层映射工具错误语义） */
export class LibraryError extends Error {
	/** 错误码 */
	readonly code: LibraryErrorCode;

	/**
	 * @param code 错误码
	 * @param message 人读信息
	 */
	constructor(code: LibraryErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

/**
 * 书库服务（读取/导出门面 + 导入写面）
 */
export class LibraryService {
	/** 书库根 */
	readonly libraryRoot: string;
	/** 工作区根（读访问控制；undefined = 不做书单过滤——导入/书库管理侧） */
	private readonly workspaceRoot?: string;
	/** 只读 store 实例缓存（bookId → store；跨调用复用连接） */
	private readonly readonlyStores = new Map<string, SqliteNovelStore>();

	/**
	 * @param options 书库根 + 可选工作区根（读访问控制）
	 */
	constructor(options: LibraryServiceOptions) {
		this.libraryRoot = options.libraryRoot;
		this.workspaceRoot = options.workspaceRoot;
	}

	/**
	 * 释放缓存的只读 store 句柄（服务弃用前调用——GUI 热重绑换实例、测试清理临时目录；
	 * Windows 下未关句柄会锁 db 文件致目录不可删）
	 */
	close(): void {
		for (const store of this.readonlyStores.values()) {
			store.close();
		}
		this.readonlyStores.clear();
	}

	// ── 写面：导入（确定性解析；大纲零产出） ──

	/**
	 * 导入一本书：校验/转码 → 确定性解析 → 分批文件 + manifest + 卷章发布骨架入库
	 * @param input 源文件路径 + 可选书名/bookId（测试复现用）
	 * @returns 导入结果（bookId + 统计）
	 */
	async importBook(input: {
		sourcePath: string;
		title?: string;
		bookId?: string;
	}): Promise<ImportBookResult> {
		const bookId = input.bookId ?? nextBookId();
		if (!isValidBookId(bookId)) {
			throw new LibraryError("LIB_INVALID_ARGUMENT", `非法 bookId：${bookId}`);
		}
		let buf: Buffer;
		try {
			const s = await stat(input.sourcePath);
			if (!s.isFile()) {
				throw new LibraryError("LIB_INVALID_ARGUMENT", "源路径不是文件");
			}
			if (s.size > SOURCE_MAX_BYTES) {
				throw new LibraryError(
					"LIB_INVALID_ARGUMENT",
					`源文件超过 20 MiB 上限（${s.size} 字节）`,
				);
			}
			buf = await readFile(input.sourcePath);
		} catch (err) {
			if (err instanceof LibraryError) throw err;
			throw new LibraryError(
				"LIB_IMPORT_FAILED",
				`源文件不可读：${err instanceof Error ? err.message : String(err)}`,
			);
		}
		const dir = bookDir(this.libraryRoot, bookId);
		try {
			const text = decodeBookSource(buf);
			const parsed = parseBookText(text);
			// ① 目录 + 原文 + 分批文件 + manifest
			await mkdir(bookSourceDir(this.libraryRoot, bookId), { recursive: true });
			await mkdir(bookParagraphsDir(this.libraryRoot, bookId), { recursive: true });
			const sourceFile = sanitizeFileName(input.sourcePath);
			await writeFile(join(bookSourceDir(this.libraryRoot, bookId), sourceFile), text, "utf8");

			const manifest: ParagraphManifestEntry[] = [];
			let seq = 0;
			for (const volume of parsed.volumes) {
				for (const chapter of volume.chapters) {
					for (const batch of chapter.batches) {
						seq += 1;
						const id = paragraphIdOf(bookId, seq);
						const relFile = `paragraphs/${id}.md`;
						await writeFile(
							paragraphFilePath(this.libraryRoot, bookId, id),
							batch,
							"utf8",
						);
						manifest.push({
							id,
							chapterNo: chapter.no,
							chapterTitle: chapter.title,
							chars: batch.length,
							file: relFile,
						});
					}
				}
			}
			await writeFile(
				bookManifestPath(this.libraryRoot, bookId),
				manifest.map((e) => JSON.stringify(e)).join("\n") + "\n",
				"utf8",
			);

			// ② 每书 book.db：WAL 初始化 + 卷/章发布骨架（paragraphIds 空、无 story unit）
			const dbPath = bookDbPath(this.libraryRoot, bookId);
			SqliteNovelStore.ensureWal(dbPath);
			const store = new SqliteNovelStore(dbPath);
			try {
				const volumeIds = new Map<number, string>();
				const mutations: NovelMutation[] = [];
				for (const volume of parsed.volumes) {
					if (volume.title === null) continue;
					const volumeId = `${bookId}-vol${String(volume.no).padStart(2, "0")}`;
					volumeIds.set(volume.no, volumeId);
					mutations.push({
						op: "publication.volume.create",
						id: volumeId,
						title: volume.title,
					});
				}
				let chapterSeq = 0;
				for (const volume of parsed.volumes) {
					for (const chapter of volume.chapters) {
						chapterSeq += 1;
						mutations.push({
							op: "publication.chapter.create",
							id: `${bookId}-ch${String(chapterSeq).padStart(4, "0")}`,
							...(volumeIds.has(volume.no)
								? { volumeId: volumeIds.get(volume.no) as PublicationVolumeId }
								: {}),
							title: chapter.title,
						});
					}
				}
				for (let i = 0; i < mutations.length; i += MUTATE_CHUNK) {
					await store.mutateBatch(mutations.slice(i, i + MUTATE_CHUNK));
				}
			} finally {
				store.close();
			}

			// ③ book.meta.json（status=解析中；Agent 收尾翻转）
			const now = new Date().toISOString();
			const stats = {
				volumes: parsed.volumes.filter((v) => v.title !== null).length,
				chapters: parsed.volumes.reduce((n, v) => n + v.chapters.length, 0),
				batches: manifest.length,
				chars: parsed.totalChars,
				paragraphs: parsed.totalParagraphCount,
			};
			await this.writeMeta(bookId, {
				bookId,
				title: input.title?.trim() !== "" && input.title !== undefined ? input.title : stripExt(sourceFile),
				sourceFile,
				status: "解析中",
				stats,
				createdAt: now,
				updatedAt: now,
			});
			return { bookId, bookDir: bookId, stats };
		} catch (err) {
			// 半截产物一律回滚（目录整体删除，不留脏书）
			await rm(dir, { recursive: true, force: true }).catch(() => {});
			if (err instanceof LibraryError) throw err;
			throw new LibraryError(
				"LIB_IMPORT_FAILED",
				`导入失败已回滚：${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// ── 读面：书目 / 实体 / 分段 / 分析产物 ──

	/**
	 * 列书（overview）：给定 workspaceRoot 时按书单过滤（默认无）
	 * @returns 书目摘要列表（按导入时间序）
	 */
	async listBooks(): Promise<BookSummary[]> {
		const allow =
			this.workspaceRoot === undefined
				? undefined
				: await readLibraryAllowlist(this.workspaceRoot);
		const out: BookSummary[] = [];
		let entries: Dirent[] = [];
		try {
			entries = await readdir(this.libraryRoot, { withFileTypes: true });
		} catch {
			return [];
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || !isValidBookId(entry.name)) continue;
			if (allow !== undefined && !allow.has(entry.name)) continue;
			try {
				const meta = await this.readMeta(entry.name);
				out.push({
					...meta,
					hasStyle: await existsFile(analysisFilePath(this.libraryRoot, entry.name, "style")),
					hasExcerpt: await existsFile(
						analysisFilePath(this.libraryRoot, entry.name, "excerpt"),
					),
				});
			} catch {
				// 目录存在但 meta 缺失/损坏：跳过（不视为可读书目）
			}
		}
		return out;
	}

	/**
	 * 打开某书 novel 域 store（上层实体查询复用 NovelRead 语义的载体）
	 * @param bookId 书 id（经书单校验）
	 * @param options readOnly 缺省 true（读路径）；false 供解析子进程写
	 * @returns store 实例（readOnly 时缓存复用）
	 */
	async openBookStore(bookId: string, options?: { readOnly?: boolean }): Promise<NovelStore> {
		await this.assertReadableBook(bookId);
		const dbPath = bookDbPath(this.libraryRoot, bookId);
		if (await existsFile(dbPath)) {
			if (options?.readOnly === false) {
				return new SqliteNovelStore(dbPath);
			}
			const cached = this.readonlyStores.get(bookId);
			if (cached !== undefined) return cached;
			const store = new SqliteNovelStore(dbPath, { readOnly: true });
			this.readonlyStores.set(bookId, store);
			return store;
		}
		throw new LibraryError("LIB_BOOK_NOT_FOUND", `书不存在：${bookId}`);
	}

	/**
	 * 读分段索引（manifest）
	 * @param bookId 书 id（经书单校验）
	 * @returns 索引条目（全书有序）
	 */
	async readManifest(bookId: string): Promise<ParagraphManifestEntry[]> {
		await this.assertReadableBook(bookId);
		const raw = await readFile(bookManifestPath(this.libraryRoot, bookId), "utf8");
		return raw
			.split(/\r?\n/)
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as ParagraphManifestEntry);
	}

	/**
	 * 读分段正文（按 id 或按章批量；条数护栏）
	 * @param bookId 书 id（经书单校验）
	 * @param query ids 精确取 / chapterNo 批量取；省略 = 全书顺序翻页
	 * @returns 分页结果（items 含正文）
	 */
	async readParagraphs(
		bookId: string,
		query: {
			ids?: readonly string[];
			chapterNo?: number;
			offset?: number;
			limit?: number;
		},
	): Promise<{ items: Array<ParagraphManifestEntry & { text: string }>; total: number }> {
		const manifest = await this.readManifest(bookId);
		const matched =
			query.ids !== undefined
				? manifest.filter((e) => query.ids?.includes(e.id))
				: query.chapterNo !== undefined
					? manifest.filter((e) => e.chapterNo === query.chapterNo)
					: manifest;
		const limit = Math.min(query.limit ?? PARAGRAPH_BATCH_DEFAULT, PARAGRAPH_BATCH_MAX);
		const offset = query.offset ?? 0;
		const slice = matched.slice(offset, offset + limit);
		const items: Array<ParagraphManifestEntry & { text: string }> = [];
		for (const entry of slice) {
			const text = await readFile(
				join(bookDir(this.libraryRoot, bookId), entry.file),
				"utf8",
			);
			items.push({ ...entry, text });
		}
		return { items, total: matched.length };
	}

	/**
	 * 读分析产物（style / excerpt；长度护栏截断）
	 * @param bookId 书 id（经书单校验）
	 * @param which style=全局风格 md / excerpt=特色原文
	 * @param maxChars 截断上限（缺省 20000）
	 * @returns 内容 + 截断位
	 */
	async readAnalysis(
		bookId: string,
		which: "style" | "excerpt",
		maxChars?: number,
	): Promise<{ content: string; truncated: boolean }> {
		await this.assertReadableBook(bookId);
		const path = analysisFilePath(this.libraryRoot, bookId, which);
		if (!(await existsFile(path))) {
			throw new LibraryError(
				"LIB_BOOK_NOT_FOUND",
				`该书尚无${which === "style" ? "风格分析" : "特色摘录"}产物（解析未完成？）`,
			);
		}
		const raw = await readFile(path, "utf8");
		const cap = maxChars ?? ANALYSIS_MAX_CHARS;
		if (raw.length <= cap) return { content: raw, truncated: false };
		return { content: `${raw.slice(0, cap)}\n\n…（已截断，全文 ${raw.length} 字符）`, truncated: true };
	}

	/**
	 * 好句好段按 tag 召回（analysis/highlights.jsonl；解析 Agent 边读边记的
	 * 可复用范句库——体现作者风格的好句好段 + 多关键字 tag，创作侧按关键字召回）
	 * @param bookId 书 id
	 * @param query tags 关键字过滤（mode=any 命中任一即中 / all 全部命中；缺省 any）
	 * @returns 命中条目（按文件序）+ 截断标记
	 */
	async searchHighlights(
		bookId: string,
		query?: { tags?: readonly string[]; mode?: "any" | "all"; limit?: number },
	): Promise<{ items: HighlightEntry[]; total: number; truncated: boolean }> {
		await this.assertReadableBook(bookId);
		const path = highlightsFilePath(this.libraryRoot, bookId);
		if (!(await existsFile(path))) {
			throw new LibraryError(
				"LIB_BOOK_NOT_FOUND",
				"该书尚无好句好段库（解析未完成？）",
			);
		}
		const raw = await readFile(path, "utf8");
		const all: HighlightEntry[] = [];
		for (const line of raw.split(/\r?\n/)) {
			if (line.trim().length === 0) continue;
			// 脏行容错：非法 JSON / 形状不符的行跳过，不中断召回
			let entry: HighlightEntry;
			try {
				entry = JSON.parse(line) as HighlightEntry;
			} catch {
				continue;
			}
			if (
				typeof entry.paragraphId === "string" &&
				Array.isArray(entry.tags) &&
				typeof entry.text === "string"
			) {
				all.push(entry);
			}
		}
		const wanted = (query?.tags ?? []).filter((t) => t.trim().length > 0);
		const mode = query?.mode ?? "any";
		const matched =
			wanted.length === 0
				? all
				: all.filter((e) =>
						mode === "all"
							? wanted.every((t) => e.tags.includes(t))
							: wanted.some((t) => e.tags.includes(t)),
					);
		const limit = Math.min(query?.limit ?? HIGHLIGHTS_DEFAULT_LIMIT, HIGHLIGHTS_MAX_LIMIT);
		const items = matched.slice(0, limit);
		return { items, total: matched.length, truncated: matched.length > items.length };
	}

	/**
	 * 解析进度（GUI 3s 轮询读面）：outline 覆盖推导——全部 scene synopsis/intent
	 * 中出现的分段 id 取最大序号（顺序解析的读取游标）/ manifest 总数。
	 * synopsis 是自由文本，只认完整 id 形式（`<bookId>-p<6位序>`），不依赖固定句式。
	 * @param bookId 书 id
	 * @returns 进度（无任何 scene 引用时 indeterminate）
	 */
	async analysisProgress(bookId: string): Promise<AnalysisProgress> {
		await this.assertReadableBook(bookId);
		const meta = await this.readMeta(bookId);
		const manifest = await this.readManifest(bookId);
		const totalBatches = manifest.length;
		const store = await this.openBookStore(bookId, { readOnly: true });
		const outline = (await store.query({ op: "outline.get" })) as {
			units: ReadonlyArray<{ scope?: string; synopsis?: string; intent?: string }>;
		};
		const idRe = new RegExp(`${bookId}-p(\\d{6})`, "g");
		let maxSeq = 0;
		for (const unit of outline.units) {
			const text = `${unit.synopsis ?? ""}\n${unit.intent ?? ""}`;
			for (const m of text.matchAll(idRe)) {
				const seq = Number(m[1]);
				if (seq > maxSeq) maxSeq = seq;
			}
		}
		const coveredBatches = Math.min(maxSeq, totalBatches);
		return {
			status: meta.status,
			totalBatches,
			coveredBatches,
			percent: totalBatches === 0 || maxSeq === 0 ? 0 : Math.round((coveredBatches / totalBatches) * 100),
			indeterminate: maxSeq === 0,
			unitCount: outline.units.length,
		};
	}

	/**
	 * 更新书状态（book.meta.json 局部字段合并；导入失败/冒烟/管理侧用；
	 * Agent 收尾也可经文件工具直接编辑）
	 * @param bookId 书 id（不做书单校验——写侧）
	 * @param patch 合并字段（status / stats 等）
	 */
	async updateBookMeta(bookId: string, patch: Partial<BookMeta>): Promise<void> {
		const meta = await this.readMeta(bookId);
		await this.writeMeta(bookId, { ...meta, ...patch, updatedAt: new Date().toISOString() });
	}

	/**
	 * 读某书元数据（经书单校验——读面，GUI 进度/详情用）
	 * @param bookId 书 id
	 * @returns 元数据
	 */
	async readBookMeta(bookId: string): Promise<BookMeta> {
		await this.assertReadableBook(bookId);
		return this.readMeta(bookId);
	}

	/**
	 * 读某书元数据（不做书单校验——内部/写侧）
	 * @param bookId 书 id
	 * @returns 元数据
	 */
	async readMeta(bookId: string): Promise<BookMeta> {
		if (!isValidBookId(bookId)) {
			throw new LibraryError("LIB_INVALID_ARGUMENT", `非法 bookId：${bookId}`);
		}
		try {
			const meta = JSON.parse(
				await readFile(bookMetaPath(this.libraryRoot, bookId), "utf8"),
			) as BookMeta;
			if (meta === null || typeof meta !== "object" || meta.bookId !== bookId) {
				throw new Error("meta 损坏");
			}
			return meta;
		} catch {
			throw new LibraryError("LIB_BOOK_NOT_FOUND", `书不存在或元数据损坏：${bookId}`);
		}
	}

	/**
	 * 书单校验（workspaceRoot 未配置 = 书库管理侧，跳过）
	 * @param bookId 书 id
	 */
	private async assertReadableBook(bookId: string): Promise<void> {
		if (!isValidBookId(bookId)) {
			throw new LibraryError("LIB_INVALID_ARGUMENT", `非法 bookId：${bookId}`);
		}
		if (this.workspaceRoot !== undefined) {
			const allow = await readLibraryAllowlist(this.workspaceRoot);
			if (!allow.has(bookId)) {
				// 不泄漏该书是否存在：统一「未授权访问」
				throw new LibraryError("LIB_BOOK_NOT_AUTHORIZED", `未授权访问该书（书单未包含）：${bookId}`);
			}
		}
	}

	/**
	 * 写元数据（原子覆盖）
	 * @param bookId 书 id
	 * @param meta 完整元数据
	 */
	private async writeMeta(bookId: string, meta: BookMeta): Promise<void> {
		await mkdir(bookDir(this.libraryRoot, bookId), { recursive: true });
		await writeFile(bookMetaPath(this.libraryRoot, bookId), JSON.stringify(meta, null, 2), "utf8");
	}
}

/**
 * 源文件编码探测解码（UTF-8 严格 → GB18030 → Big5）
 * @param buf 原始字节
 * @returns UTF-8 文本
 */
export function decodeBookSource(buf: Buffer): string {
	const candidates = ["utf-8", "gb18030", "big5"] as const;
	for (const encoding of candidates) {
		try {
			return new TextDecoder(encoding, { fatal: true }).decode(buf);
		} catch {
			// 尝试下一编码
		}
	}
	throw new LibraryError("LIB_IMPORT_FAILED", "无法识别源文件编码（支持 UTF-8 / GB18030 / Big5）");
}

/**
 * 路径 → 安全源文件名（去目录、去非法字符；缺省 book-source.txt）
 * @param sourcePath 源路径
 * @returns 安全文件名
 */
function sanitizeFileName(sourcePath: string): string {
	const base = sourcePath.split(/[\\/]/).pop() ?? "";
	const cleaned = base.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "");
	return cleaned.length > 0 ? cleaned.slice(0, 120) : "book-source.txt";
}

/**
 * 去扩展名
 * @param fileName 文件名
 * @returns 去扩展结果
 */
function stripExt(fileName: string): string {
	const dot = fileName.lastIndexOf(".");
	return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * 文件存在探测
 * @param path 路径
 * @returns 是否存在
 */
async function existsFile(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}
