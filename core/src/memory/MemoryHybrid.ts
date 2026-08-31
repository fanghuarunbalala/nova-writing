/**
 * 混合检索（PRD memory-两层记忆 D10）：BM25 词法序 + 向量余弦序 → RRF 融合
 * （k=60，免分数归一化）→ top-K 候选 → LLM rerank（一次小调用输出 JSON 分数，
 * 8s 超时/解析失败静默回退融合序）→ maxResults 截断。
 *
 * 向量缓存：memory/.embeddings.json（{modelId, entries: {name → {hash, dim,
 * vector}}}）。条目级失效——hash = SHA-256(description + "\n" + modified)，内容或
 * 时间戳变更重嵌；换 modelId 全量重嵌；条目删除剪除。查询时批量懒嵌入缺失项
 * （单次 embed 调用）；嵌入不可用（未配置/失败）→ 该次查询纯 BM25（缓存不动）。
 * rerank 默认开启，NOVEL_MEMORY_RERANK=0 关闭；失败不抛错。
 */
import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Logger } from "../log/Logger.js";
import type { Embedder } from "./LocalEmbedder.js";
import { bm25Rank } from "./MemorySearch.js";
import type { MemoryTopic } from "./MemoryStore.js";

/** RRF 常数（标准 60：rank r 得 1/(k+r)，两序同权） */
const RRF_K = 60;
/** 融合后送 rerank 的候选池大小 */
const RERANK_POOL = 12;
/** rerank 超时（ms）：记忆检索是低频操作，但绝不值得长等 */
const RERANK_TIMEOUT_MS = 8_000;
/** 向量缓存文件名（memory/ 下） */
export const MEMORY_EMBEDDINGS_FILE = ".embeddings.json";

/** 混合检索候选（含两路分数与最终排序依据） */
export interface HybridCandidate {
	readonly name: string;
	readonly description: string;
	readonly type: MemoryTopic["type"];
	readonly status: "active" | "superseded";
}

/** rerank 通道：一次 LLM 调用对候选按查询相关性打分（0-10） */
export type Reranker = (query: string, candidates: readonly HybridCandidate[]) => Promise<
	{ name: string; score: number }[]
>;

/** 混合检索选项 */
export interface HybridSearchOptions {
	readonly embedder?: Embedder;
	readonly reranker?: Reranker;
	/** 融合候选池（缺省 12） */
	readonly rerankPool?: number;
	readonly logger?: Logger;
}

/** 向量缓存条目 */
interface CacheEntry {
	hash: string;
	dim: number;
	vector: number[];
}

/** 向量缓存文件形状 */
interface EmbeddingsCache {
	modelId: string;
	entries: Record<string, CacheEntry>;
}

/** 嵌入文本（name + description 拼合，检索语义主体） */
function embedText(topic: MemoryTopic): string {
	return `${topic.name}\n${topic.description}`;
}

/** 条目内容指纹（description+modified 变更即失效） */
function entryHash(topic: MemoryTopic): string {
	return createHash("sha256").update(`${topic.description}\n${topic.modified}`).digest("hex").slice(0, 16);
}

/** 余弦相似度（向量已 normalize 时等价点积；缓存与查询同源 normalize 保证） */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	const len = Math.min(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < len; i++) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** RRF 融合两路排名 → 综合名次表 */
export function rrfFuse(
	lexical: readonly string[],
	semantic: readonly string[],
	k = RRF_K,
): { name: string; score: number }[] {
	const scores = new Map<string, number>();
	const add = (ranking: readonly string[]) => {
		ranking.forEach((name, index) => {
			scores.set(name, (scores.get(name) ?? 0) + 1 / (k + index + 1));
		});
	};
	add(lexical);
	add(semantic);
	return [...scores.entries()]
		.map(([name, score]) => ({ name, score }))
		.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.name < b.name ? -1 : 1));
}

/** 读向量缓存（缺失/损坏/模型不符返回空缓存） */
async function readCache(cachePath: string, modelId: string): Promise<EmbeddingsCache> {
	try {
		const raw = JSON.parse(await readFile(cachePath, "utf8")) as EmbeddingsCache;
		if (raw.modelId !== modelId || typeof raw.entries !== "object" || raw.entries === null) {
			return { modelId, entries: {} };
		}
		return raw;
	} catch {
		return { modelId, entries: {} };
	}
}

/** 原子写向量缓存 */
async function writeCache(cachePath: string, cache: EmbeddingsCache): Promise<void> {
	const tmp = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmp, JSON.stringify(cache), "utf8");
	try {
		await rename(tmp, cachePath);
	} catch {
		await rm(tmp, { force: true });
		// Windows rename 不覆盖：移除后重试一次
		await rm(cachePath, { force: true });
		await writeFile(tmp, JSON.stringify(cache), "utf8");
		await rename(tmp, cachePath).catch(() => rm(tmp, { force: true }));
	}
}

/**
 * 混合检索入口：
 * 1. BM25 全量排名（语料=全部主题文件）；
 * 2. embedder 可用时：补齐缺失向量（批量）→ 余弦排名；不可用时跳过（纯词法）；
 * 3. RRF 融合 → rerankPool 截断 → reranker 可用时重排（失败回退融合序）→ maxResults。
 * @param workspace 工作区根（memory/ 所在）
 * @param topics 全部主题（调用方已读盘；含 superseded）
 * @param query 查询
 * @param maxResults 截断
 * @param options embedder/reranker
 * @returns 排序候选（name 到 topics 的映射由调用方还原）
 */
export async function hybridSearch(
	workspace: string,
	topics: readonly MemoryTopic[],
	query: string,
	maxResults: number,
	options?: HybridSearchOptions,
): Promise<HybridCandidate[]> {
	const limit = Math.max(1, maxResults);
	if (topics.length === 0) return [];
	// ① BM25 排名
	const lexical = bm25Rank(
		topics.map((t) => ({ key: t.name, name: t.name, description: t.description })),
		query,
	).map((r) => r.key);
	// ② 向量排名（embedder 缺席/失败 → 空，融合退化为词法序）
	let semantic: string[] = [];
	const embedder = options?.embedder;
	if (embedder !== undefined) {
		try {
			const cachePath = join(workspace, "memory", MEMORY_EMBEDDINGS_FILE);
			const cache = await readCache(cachePath, embedder.modelId);
			const stale = new Set(Object.keys(cache.entries));
			// 需要嵌入的条目：缺失/指纹变更
			const toEmbed: { topic: MemoryTopic; index: number }[] = [];
			topics.forEach((topic, index) => {
				const cached = cache.entries[topic.name];
				if (cached === undefined || cached.hash !== entryHash(topic)) {
					toEmbed.push({ topic, index });
				}
			});
			if (toEmbed.length > 0) {
				const vectors = await embedder.embed(toEmbed.map((t) => embedText(t.topic)));
				toEmbed.forEach((item, i) => {
					const vector = vectors[i];
					if (vector === undefined || vector.length === 0) return;
					cache.entries[item.topic.name] = {
						hash: entryHash(item.topic),
						dim: vector.length,
						vector,
					};
				});
				// 写回前剪除已删除条目
				for (const name of stale) {
					if (!topics.some((t) => t.name === name)) delete cache.entries[name];
				}
				await mkdir(join(workspace, "memory"), { recursive: true });
				await writeCache(cachePath, cache);
			}
			// 余弦排名（仅对有向量的条目）
			const queryVector = (await embedder.embed([query]))[0];
			if (queryVector !== undefined && queryVector.length > 0) {
				const scored = topics
					.filter((t) => cache.entries[t.name] !== undefined)
					.map((t) => ({
						name: t.name,
						score: cosineSimilarity(queryVector, cache.entries[t.name]!.vector),
					}))
					.filter((s) => s.score > 0)
					.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.name < b.name ? -1 : 1));
				semantic = scored.map((s) => s.name);
			}
		} catch (error) {
			// 嵌入失败：纯词法降级（不写缓存、不抛错）
			options?.logger?.debug("memory.hybrid_embed_failed", {
				failure: error instanceof Error ? error.message.slice(0, 200) : String(error),
			});
		}
	}
	// ③ RRF 融合
	const fused = rrfFuse(lexical, semantic);
	if (fused.length === 0) return [];
	const byName = new Map(topics.map((t) => [t.name, t] as const));
	const toCandidate = (name: string): HybridCandidate => {
		const topic = byName.get(name)!;
		return { name: topic.name, description: topic.description, type: topic.type, status: topic.status };
	};
	const poolSize = options?.rerankPool ?? RERANK_POOL;
	const pool = fused.slice(0, Math.max(limit, Math.min(poolSize, fused.length)));
	// ④ LLM rerank（可选；失败/超时回退融合序）
	if (options?.reranker !== undefined && pool.length > 1) {
		try {
			const reranked = await withTimeout(
				options.reranker(query, pool.map((p) => toCandidate(p.name))),
				RERANK_TIMEOUT_MS,
			);
			const scoreMap = new Map(reranked.map((r) => [r.name, r.score] as const));
			pool.sort((a, b) => {
				const sa = scoreMap.get(a.name);
				const sb = scoreMap.get(b.name);
				// 无分的候选沉底（保持融合序内部相对次序）
				if (sa === undefined && sb === undefined) return 0;
				if (sa === undefined) return 1;
				if (sb === undefined) return -1;
				return sb - sa;
			});
		} catch (error) {
			options?.logger?.debug("memory.rerank_failed", {
				failure: error instanceof Error ? error.message.slice(0, 200) : String(error),
			});
		}
	}
	return pool.slice(0, limit).map((p) => toCandidate(p.name));
}

/** 超时包装（到点 reject；不中断底层调用——rerank 是一次性小请求） */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`rerank timeout (${ms}ms)`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * 用主 chat provider 构造 LLM reranker：一次调用对候选打 0-10 分。
 * 解析失败/格式异常由调用方（hybridSearch）回退处理。
 * @param call provider.call 闭包（复用会话 provider，小 maxTokens）
 */
export function createLlmReranker(
	call: (system: string, user: string, signal?: AbortSignal) => Promise<string>,
): Reranker {
	return async (query, candidates) => {
		const list = candidates.map((c, i) => `${i + 1}. ${c.name} — ${c.description}`).join("\n");
		const system = [
			"你是检索结果重排器。给定查询与候选记忆条目列表，按与查询的相关性打分（0=无关，10=高度相关）。",
			"只输出 JSON 数组，每项 {\"name\": 条目名, \"score\": 0-10 整数}，不要输出任何其他文字。",
		].join("\n");
		const user = `查询：${query}\n\n候选条目：\n${list}`;
		const raw = await call(system, user);
		// 容错解析：截取首个 [ 到末个 ] 的片段
		const start = raw.indexOf("[");
		const end = raw.lastIndexOf("]");
		if (start < 0 || end <= start) throw new Error("rerank 输出无 JSON 数组");
		const parsed = JSON.parse(raw.slice(start, end + 1)) as { name?: unknown; score?: unknown }[];
		return parsed
			.filter((item) => typeof item.name === "string" && typeof item.score === "number")
			.map((item) => ({ name: item.name as string, score: Math.max(0, Math.min(10, item.score as number)) }));
	};
}
