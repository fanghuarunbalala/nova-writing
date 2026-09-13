/**
 * 写作时风格示例注入装配（PRD 检索式形态示例 F3）：
 * - provider（main 动态段 novel.stylelib 数据源）：写作焦点（NovelWrite/Edit 工具记录）
 *   → novel.db 取 story_unit + leaf 计划拼查询文本 → 书库示例库混合检索 → 快照。
 *   焦点指纹缓存（bookId + storyUnitId + 库 mtime）——provider 每 call 调用但缓存命中
 *   直接返回，变更才重新检索；嵌入懒加载共享（首个焦点才加载模型，缺模型降级关键字）。
 * - seed（Compose spawn）：委派 prompt 前缀为查询文本，命中包装 <novel-style-guide>。
 * 全部失败降级 undefined（段省略 / 无 seed），不抛错不阻断——readNovelGlobalConstraints
 * 同款安全语义。
 */
import type { NovelQuery } from "../../../novel/contract/query.js";
import { OnnxEmbeddingProvider, type EmbeddingProvider } from "../../../library/stylelib/embed.js";
import {
	formatStylelibBlock,
	loadStylelibIndex,
	resolveStylelibBook,
	retrieve,
} from "../../../library/stylelib/retrieve.js";
import type { Logger } from "../../../log/Logger.js";
import type { StylelibProvider } from "../../prompt/PromptSection.js";
import type { LLMessage } from "../../provider/types.js";
import { wrapStylelibGuideMessage } from "./stylelibGuideMessage.js";
import type { WritingFocusSnapshot } from "./WritingFocusStore.js";

/** 注入装配依赖（entrypoint 组装；测试可注入 fake embedder/handle/logger） */
export interface StylelibInjectionDeps {
	/** 书库根（NOVEL_LIBRARY_ROOT） */
	readonly libraryRoot: string;
	/** 工作区根（.novel/library.json 书单定位示例库书） */
	readonly workspace: string;
	/** 写作焦点（provider 数据源；seed 不用） */
	readonly focus?: { current(): WritingFocusSnapshot | undefined };
	/** novel 查询面（焦点单元 + leaf 计划；seed 不用） */
	readonly handle?: { query<T = unknown>(q: NovelQuery): Promise<T> };
	/** 嵌入提供者（缺省懒建 Onnx 单例；模型缺失 → undefined 降级关键字检索） */
	readonly embed?: EmbeddingProvider;
	/** 结构化日志（缺省静默） */
	readonly logger?: Logger;
}

/**
 * 创建 main 动态段注入 provider（焦点指纹缓存）
 * @param deps 装配依赖（focus + handle 必备）
 * @returns StylelibProvider（焦点缺失/无库/失败 → undefined）
 */
export function createStylelibProvider(deps: StylelibInjectionDeps): StylelibProvider {
	const embedder = createLazyEmbedder(deps);
	let cache: { key: string; snapshot: StylelibSnapshot } | undefined;
	return async () => {
		try {
			const focus = deps.focus?.current();
			if (focus?.storyUnitId === undefined) return undefined;
			const bookId = await resolveStylelibBook(deps.libraryRoot, deps.workspace);
			if (bookId === undefined) return undefined;
			const index = await loadStylelibIndex(deps.libraryRoot, bookId);
			if (index === undefined || index.doc.paragraphs.length === 0) return undefined;
			const key = `${bookId}|${focus.storyUnitId}|${index.mtimeMs}`;
			if (cache?.key === key) return cache.snapshot;
			if (deps.handle === undefined) return undefined;
			const queryText = await focusQueryText(deps.handle, focus.storyUnitId);
			if (queryText === undefined) return undefined;
			const embed = await embedder.get();
			const queryVec = embed === undefined ? undefined : (await embed.embed([queryText]))[0];
			const hits = retrieve(index, queryText, queryVec);
			if (hits.length === 0) return undefined;
			const snapshot: StylelibSnapshot = {
				content: formatStylelibBlock(hits),
				source: {
					bookId,
					hits: hits.map((hit) => ({ id: hit.entry.id, styleTag: hit.entry.styleTag })),
				},
			};
			cache = { key, snapshot };
			return snapshot;
		} catch (err) {
			deps.logger?.debug("stylelib.provider_failed", {
				failure: err instanceof Error ? err.message : String(err),
			});
			return undefined;
		}
	};
}

/** StylelibGuideSnapshot 的本地别名（避免 prompt 层类型反向依赖注入层） */
type StylelibSnapshot = {
	content: string;
	source: { bookId: string; hits: Array<{ id: string; styleTag: string }> };
};

/**
 * 创建 Compose spawn seed（每任务一次检索：委派 prompt 前缀 → top-K → <novel-style-guide>）
 * @param deps 装配依赖（focus/handle 不需要）
 * @returns seed 函数（无库/无命中/失败 → undefined）
 */
export function createStylelibSeed(
	deps: StylelibInjectionDeps,
): (input: string) => Promise<LLMessage[] | undefined> {
	const embedder = createLazyEmbedder(deps);
	return async (input: string) => {
		try {
			const bookId = await resolveStylelibBook(deps.libraryRoot, deps.workspace);
			if (bookId === undefined) return undefined;
			const index = await loadStylelibIndex(deps.libraryRoot, bookId);
			if (index === undefined || index.doc.paragraphs.length === 0) return undefined;
			// 委派 prompt 是自然语言（含场景要素/当前状态描述），取前缀截断作查询文本
			const queryText = input.replace(/\s+/g, " ").trim().slice(0, 400);
			if (queryText.length === 0) return undefined;
			const embed = await embedder.get();
			const queryVec = embed === undefined ? undefined : (await embed.embed([queryText]))[0];
			const hits = retrieve(index, queryText, queryVec);
			if (hits.length === 0) return undefined;
			const message = wrapStylelibGuideMessage(formatStylelibBlock(hits));
			deps.logger?.debug("stylelib.seed_injected", {
				bookId,
				hits: hits.map((hit) => hit.entry.id).join(","),
			});
			return message === undefined ? undefined : [message];
		} catch (err) {
			deps.logger?.debug("stylelib.seed_failed", {
				failure: err instanceof Error ? err.message : String(err),
			});
			return undefined;
		}
	};
}

/**
 * 合成多个 seed 函数为一个 spawnSeedMessages（逐个隔离失败：任一异常/undefined
 * 不影响其余；合并空 = 整体 undefined 不注入）
 * @param seeds seed 函数列表
 * @returns 合成 seed
 */
export function combineSeedMessages(
	seeds: ReadonlyArray<(input: string) => Promise<LLMessage[] | undefined>>,
): (input: string) => Promise<LLMessage[] | undefined> {
	return async (input: string) => {
		const settled = await Promise.allSettled(seeds.map((seed) => seed(input)));
		const messages: LLMessage[] = [];
		for (const result of settled) {
			if (result.status === "fulfilled" && result.value !== undefined) {
				messages.push(...result.value);
			}
		}
		return messages.length > 0 ? messages : undefined;
	};
}

/**
 * 焦点查询文本：story_unit 的 title/intent/synopsis + leaf 计划的事件/节拍/地点备注
 * 文本化（人物/地点只存 id 不进查询——id 对检索是噪声）
 * @param handle novel 查询面
 * @param storyUnitId 焦点单元 id
 * @returns 查询文本（截 600 字）；单元不存在返回 undefined
 */
export async function focusQueryText(
	handle: { query<T = unknown>(q: NovelQuery): Promise<T> },
	storyUnitId: string,
): Promise<string | undefined> {
	const unit = (await handle.query({
		op: "outline.storyUnit.get",
		storyUnitId: storyUnitId as never,
		includePlans: true,
	})) as
		| {
				id?: string;
				title?: string;
				intent?: string;
				synopsis?: string;
				leaf?: {
					events?: ReadonlyArray<{ description?: string }>;
					rhythmBeats?: ReadonlyArray<{
						readerEmotion?: string;
						pointOfViewEmotion?: string;
						description?: string;
					}>;
					locations?: ReadonlyArray<{ note?: string }>;
					characters?: ReadonlyArray<{ note?: string }>;
				};
		  }
		| undefined;
	if (unit === null || typeof unit !== "object") return undefined;
	const parts: string[] = [];
	for (const text of [unit.title, unit.intent, unit.synopsis]) {
		if (typeof text === "string" && text.trim().length > 0) parts.push(text.trim());
	}
	const leaf = unit.leaf;
	if (leaf !== null && typeof leaf === "object") {
		for (const event of leaf.events ?? []) {
			if (typeof event?.description === "string") parts.push(event.description);
		}
		for (const beat of leaf.rhythmBeats ?? []) {
			for (const text of [beat?.readerEmotion, beat?.pointOfViewEmotion, beat?.description]) {
				if (typeof text === "string" && text.trim().length > 0) parts.push(text.trim());
			}
		}
		for (const binding of [...(leaf.locations ?? []), ...(leaf.characters ?? [])]) {
			if (typeof binding?.note === "string" && binding.note.trim().length > 0) {
				parts.push(binding.note.trim());
			}
		}
	}
	if (parts.length === 0) return undefined;
	return parts.join("；").slice(0, 600);
}

/** 懒建嵌入提供者（显式注入优先；Onnx 单例进程级共享；失败降级 undefined 只告警一次） */
export function createLazyEmbedder(deps: {
	embed?: EmbeddingProvider;
	logger?: Logger;
}): { get(): Promise<EmbeddingProvider | undefined> } {
	if (deps.embed !== undefined) {
		const fixed = deps.embed;
		return { get: async () => fixed };
	}
	let cached: EmbeddingProvider | undefined;
	let warned = false;
	let init: Promise<void> | undefined;
	return {
		get: async () => {
			init ??= OnnxEmbeddingProvider.create()
				.then((provider) => {
					cached = provider ?? undefined;
					if (provider === undefined && !warned) {
						warned = true;
						deps.logger?.warn("stylelib.embed_model_missing", {
							hint: "node scripts/fetch-stylelib-model.mjs 拉取嵌入模型；缺模型时检索降级纯关键字",
						});
					}
				})
				.catch((err: unknown) => {
					if (!warned) {
						warned = true;
						deps.logger?.warn("stylelib.embed_init_failed", {
							failure: err instanceof Error ? err.message : String(err),
						});
					}
				});
			await init;
			return cached;
		},
	};
}
