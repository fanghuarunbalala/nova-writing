/**
 * 建库编排（PRD F1）：manifest 分层抽样 → 批量策展（CURATION_BATCH 组/次直连
 * provider 调用，单批失败重试一次后放弃不阻断）→ 子串硬校验汇总 → 本地嵌入 →
 * 原子写 analysis/stylelib.json + stylelib.emb（两文件同次重建一起写、行序一致；
 * vectorless 建库清除残留 emb）。重建幂等（整库覆盖）。生产由 StylelibBuildRunner
 * 经 stylelib-worker.mjs 后台子进程执行（LLM/ONNX 不占主进程）；测试/冒烟可直调。
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../../log/Logger.js";
import type { Provider } from "../../runtime/provider/Provider.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import { bookDir, bookManifestPath, stylelibEmbPath, stylelibFilePath } from "../LibraryPaths.js";
import type { ParagraphManifestEntry } from "../LibraryService.js";
import {
	buildCurationPrompt,
	CURATION_SYSTEM,
	parseCuration,
	type CurateGroup,
	type CuratePick,
} from "./curate.js";
import type { EmbeddingProvider } from "./embed.js";
import { EMBED_DIM } from "./embed.js";
import { sampleGroups } from "./sample.js";
import {
	CURATION_BATCH,
	type StylelibBuildStats,
	type StylelibDoc,
	type StylelibEntry,
	stylelibIdOf,
} from "./types.js";

/** 建库选项 */
export interface StylelibBuildOptions {
	/** 书库根 */
	readonly libraryRoot: string;
	/** 书 id */
	readonly bookId: string;
	/** 策展 provider（宿主注入；OpenAI/Anthropic 适配任一） */
	readonly provider: Provider;
	/** 策展采样（模型 + maxTokens + thinking off 由宿主收紧） */
	readonly sampling: SamplingConfig;
	/** 嵌入提供者（缺省 = 无向量建库，检索降级纯关键字） */
	readonly embed?: EmbeddingProvider;
	/** 候选组数目标（缺省 CANDIDATE_TARGET） */
	readonly target?: number;
	/** 批次进度回调（已完成策展批数 / 总批数） */
	readonly onProgress?: (done: number, total: number) => void;
	/** 结构化日志（缺省静默） */
	readonly logger?: Logger;
}

/**
 * 构建风格示例库（幂等整库覆盖）
 * @param options 见 StylelibBuildOptions
 * @returns 建库统计
 */
export async function buildStylelib(options: StylelibBuildOptions): Promise<StylelibBuildStats> {
	const manifest = await readManifest(options.libraryRoot, options.bookId);
	const candidates = sampleGroups(manifest, options.target);
	const groups = await loadGroups(options.libraryRoot, options.bookId, candidates);
	const batches = chunk(groups, CURATION_BATCH);
	const dropped: {
		notSubstring: number;
		tooLong: number;
		tooShort: number;
		badTag: number;
		badGroup: number;
		duplicate: number;
	} = { notSubstring: 0, tooLong: 0, tooShort: 0, badTag: 0, badGroup: 0, duplicate: 0 };
	const picks: CuratePick[] = [];
	let done = 0;
	let failedBatches = 0;
	for (const batch of batches) {
		const batchPicks = await curateBatch(options, batch);
		if (batchPicks === undefined) {
			failedBatches += 1;
		} else {
			const result = parseCuration(batchPicks, batch);
			picks.push(...result.picks);
			dropped.notSubstring += result.dropped.notSubstring;
			dropped.tooLong += result.dropped.tooLong;
			dropped.tooShort += result.dropped.tooShort;
			dropped.badTag += result.dropped.badTag;
			dropped.badGroup += result.dropped.badGroup;
			dropped.duplicate += result.dropped.duplicate;
		}
		done += 1;
		options.onProgress?.(done, batches.length);
	}
	// 稳定排序（paragraphId 内含全书序）后顺序编号；标签分布随条目统计
	picks.sort((a, b) => (a.paragraphId < b.paragraphId ? -1 : a.paragraphId > b.paragraphId ? 1 : 0));
	const entries: StylelibEntry[] = picks.map((pick, i) => ({
		id: stylelibIdOf(options.bookId, i + 1),
		paragraphId: pick.paragraphId,
		chapterNo: pick.chapterNo,
		text: pick.text,
		styleTag: pick.styleTag,
		keywords: pick.keywords,
	}));
	const tags: Record<string, number> = {};
	for (const entry of entries) tags[entry.styleTag] = (tags[entry.styleTag] ?? 0) + 1;
	// 嵌入（缺 provider = 无向量建库；残留在库 emb 一并清除防行序错配）。
	// analysis/ 先建（导入不创建该目录；读取方都先 exists 判断，预建安全）
	await mkdir(join(bookDir(options.libraryRoot, options.bookId), "analysis"), { recursive: true });
	let vectorless = true;
	if (options.embed !== undefined && entries.length > 0) {
		const vectors = await options.embed.embed(entries.map((e) => e.text));
		const flat = new Float32Array(entries.length * EMBED_DIM);
		for (let i = 0; i < vectors.length; i++) {
			const vector = vectors[i];
			if (vector === undefined) continue;
			flat.set(vector.subarray(0, EMBED_DIM), i * EMBED_DIM);
		}
		await writeAtomic(
			stylelibEmbPath(options.libraryRoot, options.bookId),
			Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength),
		);
		vectorless = false;
	} else {
		await rm(stylelibEmbPath(options.libraryRoot, options.bookId), { force: true }).catch(() => {});
	}
	const stats: StylelibBuildStats = {
		candidates: candidates.length,
		batches: batches.length,
		failedBatches,
		kept: entries.length,
		dropped,
		tags,
		vectorless,
	};
	const doc: StylelibDoc = {
		schema: 1,
		bookId: options.bookId,
		builtAt: new Date().toISOString(),
		model: options.sampling.model,
		stats,
		paragraphs: entries,
	};
	await writeAtomic(
		stylelibFilePath(options.libraryRoot, options.bookId),
		Buffer.from(JSON.stringify(doc, null, "\t"), "utf8"),
	);
	return stats;
}

/** 单批策展调用（失败重试一次；再失败告警返回 undefined——该批产出放弃不阻断建库） */
async function curateBatch(
	options: StylelibBuildOptions,
	batch: readonly CurateGroup[],
): Promise<string | undefined> {
	const call = {
		system: CURATION_SYSTEM,
		tools: [],
		messages: [{ role: "user" as const, content: buildCurationPrompt(batch) }],
		sampling: options.sampling,
	};
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const result = await options.provider.call(call);
			const content = result.message.content;
			if (content.trim().length > 0) return content;
		} catch (err) {
			options.logger?.warn("stylelib.curate_failed", {
				bookId: options.bookId,
				attempt: attempt + 1,
				failure: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return undefined;
}

/** 读 manifest（书目录内 manifest.jsonl；复用 LibraryService 条目契约） */
async function readManifest(libraryRoot: string, bookId: string): Promise<ParagraphManifestEntry[]> {
	const raw = await readFile(bookManifestPath(libraryRoot, bookId), "utf8");
	return raw
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as ParagraphManifestEntry);
}

/** 载入候选组正文（批文件 = 自然段以空行连接；组序 1 起） */
async function loadGroups(
	libraryRoot: string,
	bookId: string,
	candidates: readonly ParagraphManifestEntry[],
): Promise<CurateGroup[]> {
	const groups: CurateGroup[] = [];
	for (const entry of candidates) {
		const batchText = await readFile(join(bookDir(libraryRoot, bookId), entry.file), "utf8");
		const paragraphs = batchText
			.split(/\r?\n(?:\r?\n)+/)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		groups.push({ no: groups.length + 1, entry, paragraphs, batchText });
	}
	return groups;
}

/** 等分块 */
function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

/** 原子写（tmp + 预删目标 + rename；Windows rename 不覆盖已存在目标） */
async function writeAtomic(path: string, data: Buffer): Promise<void> {
	const tmp = `${path}.tmp`;
	await writeFile(tmp, data);
	await rm(path, { force: true }).catch(() => {});
	await rename(tmp, path);
}
