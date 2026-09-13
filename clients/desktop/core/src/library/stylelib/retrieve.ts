/**
 * 写作时混合检索（PRD F3）：关键字路（查询整词 + 2-gram，滤函数字；条目侧
 * text+keywords 拼串命中，条目关键字反向整词强命中）∪ 向量路（余弦 top-K，
 * 嵌入缺失自动跳过）→ RRF 融合 → 风格标签多样性 → top-K 段。纯内存计算，
 * 零 LLM、零网络；查询语言（抽象大纲）与库语言（具象小说）靠策展关键字搭桥。
 */
import { readFile, stat } from "node:fs/promises";
import { readLibraryAllowlist } from "../LibraryAccessPolicy.js";
import { stylelibEmbPath, stylelibFilePath } from "../LibraryPaths.js";
import { EMBED_DIM } from "./embed.js";
import {
	INJECT_TOP_K,
	KEYWORD_TOP_N,
	RRF_K,
	VECTOR_TOP_K,
	type StylelibDoc,
	type StylelibEntry,
} from "./types.js";

/** 已载入的示例库索引（json + 向量矩阵；行序一致） */
export interface StylelibIndex {
	/** 库文档 */
	readonly doc: StylelibDoc;
	/** 向量矩阵（N × EMBED_DIM 行主序；vectorless 建库时缺省） */
	readonly vectors?: Float32Array;
	/** 文档 mtime（毫秒；注入侧焦点指纹缓存键成分） */
	readonly mtimeMs: number;
}

/** 检索命中 */
export interface StylelibHit {
	/** 命中条目 */
	readonly entry: StylelibEntry;
	/** RRF 融合分 */
	readonly score: number;
}

/** 载入缓存（路径 → 索引；mtime 变更才重读——重建后自动可见） */
const indexCache = new Map<string, { mtimeMs: number; index: StylelibIndex }>();

/**
 * 载入某书示例库索引（stylelib.json + stylelib.emb；未建/损坏/行数不符 → undefined）
 * @param libraryRoot 书库根
 * @param bookId 书 id
 * @returns 索引；未建或不可读返回 undefined
 */
export async function loadStylelibIndex(
	libraryRoot: string,
	bookId: string,
): Promise<StylelibIndex | undefined> {
	const jsonPath = stylelibFilePath(libraryRoot, bookId);
	let mtimeMs: number;
	try {
		mtimeMs = (await stat(jsonPath)).mtimeMs;
	} catch {
		return undefined;
	}
	const cacheKey = jsonPath;
	const cached = indexCache.get(cacheKey);
	if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.index;
	let doc: StylelibDoc;
	try {
		doc = JSON.parse(await readFile(jsonPath, "utf8")) as StylelibDoc;
	} catch {
		return undefined;
	}
	if (doc === null || typeof doc !== "object" || !Array.isArray(doc.paragraphs)) {
		return undefined;
	}
	let vectors: Float32Array | undefined;
	try {
		const buf = await readFile(stylelibEmbPath(libraryRoot, bookId));
		if (buf.byteLength === doc.paragraphs.length * EMBED_DIM * 4) {
			vectors = new Float32Array(
				buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			);
		}
	} catch {
		// 无嵌入文件（vectorless 建库）→ 纯关键字检索
	}
	const index: StylelibIndex = { doc, ...(vectors !== undefined ? { vectors } : {}), mtimeMs };
	indexCache.set(cacheKey, { mtimeMs, index });
	return index;
}

/**
 * 解析写作项目当前可用的示例库书（白名单内首个已建库的书；v1 单书）
 * @param libraryRoot 书库根
 * @param workspaceRoot 工作区根（.novel/library.json 书单）
 * @returns bookId；无授权书或均未建库返回 undefined
 */
export async function resolveStylelibBook(
	libraryRoot: string,
	workspaceRoot: string,
): Promise<string | undefined> {
	const allow = await readLibraryAllowlist(workspaceRoot);
	for (const bookId of [...allow].sort()) {
		try {
			if ((await stat(stylelibFilePath(libraryRoot, bookId))).isFile()) return bookId;
		} catch {
			// 未建库，看下一本
		}
	}
	return undefined;
}

/**
 * 混合检索：关键字 ∪ 向量 → RRF → 标签多样性 → top-K
 * @param index 示例库索引
 * @param queryText 查询文本（写作焦点要素 / 委派 prompt 摘要）
 * @param queryVec 查询向量（L2 归一；缺省跳过向量路）
 * @param topK 取条数（缺省 INJECT_TOP_K）
 * @param onlyTags 风格标签过滤（缺省全量；排名前过滤条目池，池空返回 []）
 * @returns 命中条目（分值降序；库空/无命中返回空数组）
 */
export function retrieve(
	index: StylelibIndex,
	queryText: string,
	queryVec?: Float32Array,
	topK: number = INJECT_TOP_K,
	onlyTags?: readonly string[],
): StylelibHit[] {
	const all = index.doc.paragraphs;
	if (all.length === 0 || topK <= 0) return [];
	// 条目池 = 原始索引数组（标签过滤在此收敛；两路排名/融合/多样性统一在池坐标系，
	// 向量矩阵仍按原始行号取数）
	const pool: number[] = [];
	for (let i = 0; i < all.length; i++) {
		const entry = all[i];
		if (entry === undefined) continue;
		if (onlyTags === undefined || onlyTags.length === 0 || onlyTags.includes(entry.styleTag)) {
			pool.push(i);
		}
	}
	if (pool.length === 0) return [];
	const poolEntries = pool.map((i) => all[i]!);
	const keywordRanking = keywordRankingOf(poolEntries, queryText);
	const vectorRanking =
		queryVec !== undefined && index.vectors !== undefined
			? vectorRankingOf(pool, index.vectors, queryVec)
			: [];
	// RRF 融合：任一路入榜即计分（两路都命中 > 单路高位）
	const scores = new Map<number, number>();
	const contribute = (ranking: readonly number[]): void => {
		for (let r = 0; r < ranking.length; r++) {
			const idx = ranking[r];
			if (idx === undefined) continue;
			scores.set(idx, (scores.get(idx) ?? 0) + 1 / (RRF_K + r + 1));
		}
	};
	contribute(keywordRanking);
	contribute(vectorRanking);
	if (scores.size === 0) return [];
	const ordered = [...scores.entries()].sort(
		(a, b) => b[1] - a[1] || a[0] - b[0],
	);
	// 标签多样性：第 2+ 席优先取未出现过的 styleTag（全同则按分值顺延）
	const picked: StylelibHit[] = [];
	const seenTags = new Set<string>();
	for (const [idx] of ordered) {
		if (picked.length >= topK) break;
		const entry = poolEntries[idx];
		if (entry === undefined) continue;
		const score = scores.get(idx) ?? 0;
		if (picked.length === 0 || !seenTags.has(entry.styleTag)) {
			picked.push({ entry, score });
			seenTags.add(entry.styleTag);
		}
	}
	if (picked.length < topK) {
		for (const [idx] of ordered) {
			if (picked.length >= topK) break;
			const entry = poolEntries[idx];
			if (entry === undefined) continue;
			if (picked.some((h) => h.entry.id === entry.id)) continue;
			picked.push({ entry, score: scores.get(idx) ?? 0 });
		}
	}
	return picked;
}

/**
 * 渲染注入块（<novel-style-guide> 内层正文；防抄袭纪律在文案内声明）
 * @param hits 命中条目
 * @returns 注入块文本；空命中返回空串
 */
export function formatStylelibBlock(hits: readonly StylelibHit[]): string {
	if (hits.length === 0) return "";
	const lines = [
		"【本书段落形态示例】（取自书库参考书，仅示范段落节奏与叙述腔，禁止复用其内容词句）",
	];
	for (const hit of hits) {
		const keywords = hit.entry.keywords.length > 0 ? `（${hit.entry.keywords.join("、")}）` : "";
		lines.push(`示例·${hit.entry.styleTag}${keywords}：`);
		lines.push(`  ${hit.entry.text}`);
	}
	return lines.join("\n");
}

/** 纯函数字集合（2-gram 两字皆函数字 → 该 gram 无效，防「的了」「是在」类噪声命中） */
const FUNCTION_CHARS = new Set(
	"的了是在和与也都很又就被把不有一个这那我你他她它们着之地得过于以及或者但而且还",
);

/**
 * 关键字路排序：查询词（整词 ×2 权 + 2-gram ×1 权）命中条目 text+keywords 拼串
 * 计分；条目关键字整词出现在查询文本中算强命中（每个 +2）。取前 KEYWORD_TOP_N。
 */
function keywordRankingOf(entries: readonly StylelibEntry[], queryText: string): number[] {
	const weighted = queryTokens(queryText);
	if (weighted.length === 0) return [];
	const ranked = entries
		.map((entry, idx) => ({ idx, hits: entryKeywordHits(entry, queryText, weighted) }))
		.filter((item) => item.hits > 0)
		.sort((a, b) => b.hits - a.hits || a.idx - b.idx);
	return ranked.slice(0, KEYWORD_TOP_N).map((item) => item.idx);
}

/** 查询词提取：连续字母/数字/汉字段（≥2 字）整词 ×2 权 + 各 2-gram ×1 权（滤函数字 gram） */
function queryTokens(queryText: string): Array<{ token: string; weight: number }> {
	const tokens = new Map<string, number>();
	for (const match of queryText.matchAll(/[\p{L}\p{N}]{2,}/gu)) {
		const word = match[0];
		if (word === undefined) continue;
		tokens.set(word, Math.max(tokens.get(word) ?? 0, 2));
		for (let i = 0; i + 2 <= word.length; i++) {
			const gram = word.slice(i, i + 2);
			const a = gram.charAt(0);
			const b = gram.charAt(1);
			if (FUNCTION_CHARS.has(a) && FUNCTION_CHARS.has(b)) continue;
			tokens.set(gram, Math.max(tokens.get(gram) ?? 0, 1));
		}
	}
	return [...tokens.entries()].map(([token, weight]) => ({ token, weight }));
}

/** 条目命中分：blob 包含查询词（加权重）+ 条目关键字反向整词强命中（每个 +2） */
function entryKeywordHits(
	entry: StylelibEntry,
	queryText: string,
	weighted: ReadonlyArray<{ token: string; weight: number }>,
): number {
	const blob = `${entry.text}\n${entry.keywords.join(" ")}`;
	let hits = 0;
	for (const { token, weight } of weighted) {
		if (blob.includes(token)) hits += weight;
	}
	for (const keyword of entry.keywords) {
		if (keyword.length >= 2 && queryText.includes(keyword)) hits += 2;
	}
	return hits;
}

/** 向量路排序：池内余弦（点积，向量按原始行号取数）top VECTOR_TOP_K（池坐标系名次） */
function vectorRankingOf(
	pool: readonly number[],
	vectors: Float32Array,
	queryVec: Float32Array,
): number[] {
	let queryNorm = 0;
	for (let d = 0; d < EMBED_DIM; d++) queryNorm += queryVec[d]! * queryVec[d]!;
	queryNorm = Math.sqrt(queryNorm);
	if (queryNorm === 0) return [];
	const ranked = pool
		.map((originalIdx, poolIdx) => {
			let dot = 0;
			let norm = 0;
			const base = originalIdx * EMBED_DIM;
			for (let d = 0; d < EMBED_DIM; d++) {
				const value = vectors[base + d] ?? 0;
				dot += value * (queryVec[d] ?? 0);
				norm += value * value;
			}
			norm = Math.sqrt(norm);
			return { poolIdx, cos: norm > 0 ? dot / (norm * queryNorm) : 0 };
		})
		.sort((a, b) => b.cos - a.cos || a.poolIdx - b.poolIdx);
	return ranked.slice(0, VECTOR_TOP_K).map((item) => item.poolIdx);
}
