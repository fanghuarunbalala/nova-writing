/**
 * ProjectImportService：项目导入确定性核心（欢迎页「从文件导入创建项目」）。
 * 与书库（LibraryService.importBook 写全局只读书库）区分：这里把既有内容直接落进
 * **本项目 novel.db**（卷/章/段落，可继续写作），并把拆分产物写到工作区
 * `.novel/import/` 供 ProjectImporter agent 通读解构。
 *
 * 章卷一致性硬保证：结构与正文只由本服务（确定性解析 + 用户确认稿）落库，正文逐字
 * 不改；解构 agent 对卷/章/段落只读（入口装配另有 op 级守卫）。
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Logger } from "../log/Logger.js";
import { parseBookText, type ParsedBook, type ParsedChapter } from "../library/BookTextParser.js";
import type { NovelStore } from "../novel/store.js";
import type { NovelMutation } from "../novel/contract/mutation.js";
import type { ParagraphId, PublicationVolumeId, StoryUnitId } from "../novel/model/id.js";
import type { OrderKey } from "../novel/model/outline.js";
import { readImportSource, type ImportSourceContent } from "./ImportSourceReader.js";
import { ImportError } from "./ImportError.js";
import {
	IMPORT_ANCHOR_UNIT_ID,
	IMPORT_ANCHOR_UNIT_TITLE,
	IMPORT_SAGA_UNIT_ID,
	batchFilePath,
	batchIdOf,
	importManifestPath,
	importMetaPath,
	importParagraphsDir,
	importSourceDir,
	paragraphIdOf,
} from "./ImportPaths.js";
import type {
	ImportChapterPreview,
	ImportJobProgress,
	ImportMeta,
	ImportPlan,
	ImportPreview,
	ImportProgress,
	ImportStats,
	ImportVolumePreview,
} from "./ImportTypes.js";

/** mutateBatch 单事务分片（对齐书库） */
const MUTATE_CHUNK = 200;

/** analyzing 视为疑似卡住的静默阈值（journal / import.json 无更新超过此时长） */
const STALLED_AFTER_MS = 10 * 60_000;

/** manifest 条目（paragraphs/manifest.jsonl 每行；对齐书库格式，id 为批次 id） */
interface ImportManifestEntry {
	readonly id: string;
	readonly chapterNo: number;
	readonly chapterTitle: string;
	readonly chars: number;
	readonly file: string;
}

/** 落库用确认稿章（计划标题/归属 + 解析批次） */
interface ResolvedChapter {
	readonly key: string;
	readonly title: string;
	readonly volumeKey: string | null;
	readonly batches: readonly string[];
}

/** 落库用确认稿 */
interface ResolvedPlan {
	readonly volumes: readonly { key: string; title: string; volumeId: string }[];
	readonly chapters: readonly ResolvedChapter[];
}

/** 服务构造选项 */
export interface ProjectImportServiceOptions {
	/** 结构化日志（解构进度观测：变化打 info、每轮打 debug；缺省静默） */
	readonly logger?: Logger;
}

/**
 * 项目导入服务（预览 / 落库 / 状态与进度读面）
 */
export class ProjectImportService {
	private readonly logger?: Logger;
	/** 上次进度日志键（变化才打 info，防 3s 轮询刷屏） */
	private lastProgressKey = "";

	constructor(options?: ProjectImportServiceOptions) {
		this.logger = options?.logger?.child({ component: "import_analysis" });
	}

	/**
	 * 预览：读源 + 确定性解析（不建工作区、不落库；UI 微调后作为计划提交）。
	 * 耗时（zip 解压 + 大文本解析），宿主应经后台进程执行（ImportProcessRunner）
	 * @param sourcePath 源路径（宿主白名单授权）
	 * @param options.onProgress 阶段进度回调
	 * @returns 卷/章/字数预览
	 */
	async prepare(
		sourcePath: string,
		options?: { onProgress?: (progress: ImportJobProgress) => void },
	): Promise<ImportPreview> {
		options?.onProgress?.({ stage: "reading", done: 0, total: 0 });
		const source = await readImportSource(sourcePath);
		options?.onProgress?.({ stage: "parsing", done: 0, total: 0 });
		const parsed = parseBookText(source.text);
		return buildPreview(source, parsed);
	}

	/**
	 * 落库：重读源 → 与计划对齐（key 校验，防文件在预览后被改动）→ 空库校验 →
	 * 写 `.novel/import/` 拆分产物 + novel.db（锚点单元/卷/章/段落，全部 create）
	 * → 写 import.json（status=analyzing）。失败抛错，调用方负责工作区级回滚。
	 * 耗时（解析 + 分批文件写 + 大量段落事务插入），宿主应经后台进程执行
	 * @param input 工作区根 + 空 store + 源路径 + 用户确认稿 + 可选阶段进度回调
	 * @returns 导入统计
	 */
	async apply(input: {
		workspaceRoot: string;
		store: NovelStore;
		sourcePath: string;
		plan: ImportPlan;
		onProgress?: (progress: ImportJobProgress) => void;
	}): Promise<ImportStats> {
		const emit = input.onProgress ?? (() => {});
		emit({ stage: "reading", done: 0, total: 0 });
		const source = await readImportSource(input.sourcePath);
		if (source.text.length !== input.plan.totalChars) {
			throw new ImportError(
				"IMP_INVALID_ARGUMENT",
				"源文件与预览时不一致（可能已被修改），请重新选择并预览",
			);
		}
		emit({ stage: "parsing", done: 0, total: 0 });
		const parsed = parseBookText(source.text);
		const resolved = resolvePlan(parsed, input.plan);
		await this.assertEmptyStore(input.store);

		// ① 拆分产物（agent 通读单元）：原文 + 批次文件 + manifest
		await mkdir(importSourceDir(input.workspaceRoot), { recursive: true });
		await mkdir(importParagraphsDir(input.workspaceRoot), { recursive: true });
		const sourceFile = sanitizeFileName(source.sourceName);
		await writeFile(join(importSourceDir(input.workspaceRoot), sourceFile), source.text, "utf8");
		const manifest: ImportManifestEntry[] = [];
		const totalBatches = resolved.chapters.reduce((n, c) => n + c.batches.length, 0);
		let batchSeq = 0;
		for (const chapter of resolved.chapters) {
			for (const batch of chapter.batches) {
				batchSeq += 1;
				emit({ stage: "writing-files", done: batchSeq, total: totalBatches });
				const id = batchIdOf(batchSeq);
				await writeFile(batchFilePath(input.workspaceRoot, id), batch, "utf8");
				manifest.push({
					id,
					chapterNo: manifestChapterNo(resolved.chapters, chapter.key),
					chapterTitle: chapter.title,
					chars: batch.length,
					file: `paragraphs/${id}.md`,
				});
			}
		}
		await writeFile(
			importManifestPath(input.workspaceRoot),
			manifest.map((e) => JSON.stringify(e)).join("\n") + "\n",
			"utf8",
		);

		// ② novel.db：锚点单元 → 全书根 saga → 卷 → （每章：段落插入 → 章创建引用段落）
		// 全书根标题用源文件名（去扩展名）：确定性可得，agent 解构时可按内容修正
		const mutations = buildMutations(resolved, source.sourceName.replace(/\.(txt|zip)$/i, ""));
		const totalChunks = Math.ceil(mutations.length / MUTATE_CHUNK);
		let chunkSeq = 0;
		for (let i = 0; i < mutations.length; i += MUTATE_CHUNK) {
			chunkSeq += 1;
			emit({ stage: "writing-db", done: chunkSeq, total: totalChunks });
			await input.store.mutateBatch(mutations.slice(i, i + MUTATE_CHUNK));
		}

		// ③ import.json（status=analyzing；agent 收尾翻转）
		const stats: ImportStats = {
			volumes: resolved.volumes.length,
			chapters: resolved.chapters.length,
			paragraphs: countParagraphs(mutations),
			batches: manifest.length,
			chars: source.text.length,
		};
		const now = new Date().toISOString();
		await this.writeMeta(input.workspaceRoot, {
			importId: `imp-${randomBytes(4).toString("hex")}`,
			status: "analyzing",
			sourceName: source.sourceName,
			stats,
			createdAt: now,
			updatedAt: now,
		});
		return stats;
	}

	/**
	 * 读导入元数据
	 * @param workspaceRoot 工作区根
	 * @returns 元数据（无 import.json = 非导入创建的项目 → undefined）
	 */
	async readMeta(workspaceRoot: string): Promise<ImportMeta | undefined> {
		try {
			const raw = await readFile(importMetaPath(workspaceRoot), "utf8");
			const meta = JSON.parse(raw) as ImportMeta;
			if (meta === null || typeof meta !== "object" || typeof meta.status !== "string") {
				return undefined;
			}
			return meta;
		} catch {
			return undefined;
		}
	}

	/**
	 * 更新导入状态（重试/降级置 failed 等；agent 侧经文件工具直接编辑 import.json）
	 * @param workspaceRoot 工作区根
	 * @param patch 合并字段
	 */
	async markStatus(
		workspaceRoot: string,
		patch: Partial<Pick<ImportMeta, "status" | "statusReason">>,
	): Promise<void> {
		const meta = await this.readMeta(workspaceRoot);
		if (meta === undefined) {
			throw new ImportError("IMP_NOT_FOUND", "该项目没有导入记录（import.json 缺失）");
		}
		// statusReason 语义：failed 保留/写入原因；其余状态清空
		const status = patch.status ?? meta.status;
		const reason = status === "failed" ? (patch.statusReason ?? meta.statusReason) : undefined;
		const { statusReason: _old, ...rest } = meta;
		await this.writeMeta(workspaceRoot, {
			...rest,
			status,
			...(reason !== undefined ? { statusReason: reason } : {}),
			updatedAt: new Date().toISOString(),
		});
	}

	/**
	 * 解构进度（UI 3s 轮询）：双信号取最大——
	 * ① outline 覆盖（story unit synopsis/intent 中的批次 id 最大序号）；
	 * ② 解构会话 journal（Read 工具调用参数里的 paragraphs/imp-bXXXXXX）。
	 * @param workspaceRoot 工作区根
	 * @param store 项目 novel store（outline 信号）
	 * @param journalPath 解构会话 journal 路径（可选；读不到静默忽略）
	 * @returns 进度（无 import.json → status=none）
	 */
	async progress(
		workspaceRoot: string,
		store: NovelStore,
		journalPath?: string,
	): Promise<ImportProgress> {
		const meta = await this.readMeta(workspaceRoot);
		if (meta === undefined) {
			return {
				status: "none",
				totalBatches: 0,
				coveredBatches: 0,
				percent: 0,
				indeterminate: true,
				unitCount: 0,
			};
		}
		const totalBatches = await countManifestEntries(workspaceRoot);
		let maxSeq = 0;
		let unitCount = 0;
		try {
			const outline = (await store.query({ op: "outline.get" })) as {
				units?: ReadonlyArray<{ synopsis?: string; intent?: string }>;
			};
			unitCount = outline.units?.length ?? 0;
			const idRe = /imp-b(\d{6})/g;
			for (const unit of outline.units ?? []) {
				const text = `${unit.synopsis ?? ""}\n${unit.intent ?? ""}`;
				for (const m of text.matchAll(idRe)) {
					const seq = Number(m[1]);
					if (seq > maxSeq) maxSeq = seq;
				}
			}
		} catch {
			// outline 读取失败：退回 journal 信号
		}
		// 诊断观测（不影响进度计算）：journal 是否被定位、现行正则命中数与宽匹配对照数
		// —— slashMatches 持续为 0 而 anyMatches > 0 即坐实「Windows 反斜杠路径失配」；
		// journalExists=false 即 journal 定位问题；两者皆 0 且 unitCount=0 即 agent 未产出。
		let journalExists = false;
		let journalChars = 0;
		let journalSlashMatches = 0;
		let journalAnyMatches = 0;
		if (journalPath !== undefined && (journalExists = await existsFile(journalPath))) {
			try {
				const journal = await readFile(journalPath, "utf8");
				journalChars = journal.length;
				journalSlashMatches = [...journal.matchAll(/paragraphs\/imp-b(\d{6})/g)].length;
				journalAnyMatches = [...journal.matchAll(/imp-b(\d{6})/g)].length;
				for (const m of journal.matchAll(/paragraphs\/imp-b(\d{6})/g)) {
					const seq = Number(m[1]);
					if (seq > maxSeq) maxSeq = seq;
				}
			} catch {
				// journal 写入中竞态：忽略
			}
		}
		const coveredBatches = Math.min(maxSeq, totalBatches);
		// 疑似卡住判定：analyzing 且最近活动（journal mtime，缺省退 import.json updatedAt）
		// 超过阈值——端点停滞（provider 悬挂）或应用中途关闭都会命中
		let stalled = false;
		if (meta.status === "analyzing") {
			let lastActivity: number | undefined;
			if (journalPath !== undefined) {
				try {
					lastActivity = (await stat(journalPath)).mtimeMs;
				} catch {
					// journal 未建（首调在途）：退回 import.json 更新时间
				}
			}
			if (lastActivity === undefined) {
				const t = Date.parse(meta.updatedAt);
				if (!Number.isNaN(t)) lastActivity = t;
			}
			stalled = lastActivity !== undefined && Date.now() - lastActivity > STALLED_AFTER_MS;
		}
		const result: ImportProgress = {
			status: meta.status,
			totalBatches,
			coveredBatches,
			percent:
				totalBatches === 0 || maxSeq === 0
					? 0
					: Math.round((coveredBatches / totalBatches) * 100),
			indeterminate: maxSeq === 0,
			unitCount,
			...(meta.statusReason !== undefined ? { statusReason: meta.statusReason } : {}),
			...(stalled ? { stalled: true } : {}),
		};
		// 进度变化打 info（3s 轮询防刷屏）；每轮 debug 带全量诊断字段
		const key = `${meta.status}|${coveredBatches}|${unitCount}|${stalled}`;
		if (key !== this.lastProgressKey) {
			this.lastProgressKey = key;
			this.logger?.info("import_analysis.progress", { ...result });
		}
		this.logger?.debug("import_analysis.poll", {
			status: meta.status,
			totalBatches,
			coveredBatches,
			unitCount,
			stalled,
			journalPath,
			journalExists,
			journalChars,
			journalSlashMatches,
			journalAnyMatches,
		});
		return result;
	}

	/** 空库校验（导入只面向全新项目；防把内容混入已有项目） */
	private async assertEmptyStore(store: NovelStore): Promise<void> {
		const pub = (await store.query({ op: "publication.get" })) as {
			volumes?: unknown[];
			chapters?: unknown[];
		};
		if ((pub.volumes?.length ?? 0) > 0 || (pub.chapters?.length ?? 0) > 0) {
			throw new ImportError("IMP_PROJECT_NOT_EMPTY", "目标项目不为空（已有卷/章），导入仅支持全新项目");
		}
		const outline = (await store.query({ op: "outline.get" })) as { units?: unknown[] };
		if ((outline.units?.length ?? 0) > 0) {
			throw new ImportError("IMP_PROJECT_NOT_EMPTY", "目标项目不为空（已有大纲），导入仅支持全新项目");
		}
	}

	/** 写元数据（原子覆盖） */
	private async writeMeta(workspaceRoot: string, meta: ImportMeta): Promise<void> {
		await mkdir(dirname(importMetaPath(workspaceRoot)), { recursive: true });
		await writeFile(importMetaPath(workspaceRoot), JSON.stringify(meta, null, 2), "utf8");
	}
}

/** 预览构建（源 + 解析 → 卷章元数据；不传正文） */
function buildPreview(source: ImportSourceContent, parsed: ParsedBook): ImportPreview {
	const volumes: ImportVolumePreview[] = [];
	const volumeKeyOf = new Map<number, string>();
	for (const volume of parsed.volumes) {
		if (volume.title === null) continue;
		const key = `v${volume.no}`;
		volumeKeyOf.set(volume.no, key);
		volumes.push({ key, title: volume.title });
	}
	const chapters: ImportChapterPreview[] = [];
	for (const volume of parsed.volumes) {
		for (const chapter of volume.chapters) {
			chapters.push({
				key: `c${chapter.no}`,
				title: chapter.title,
				chars: chapter.batches.reduce((n, b) => n + b.length, 0),
				volumeKey: volumeKeyOf.get(volume.no) ?? null,
			});
		}
	}
	return {
		sourceName: source.sourceName,
		kind: source.kind,
		totalChars: source.text.length,
		volumes,
		chapters,
		skippedFiles: source.skippedFiles,
	};
}

/** 计划对齐：key 逐一校验（防篡改/文件变动），标题与归属取计划（确认稿） */
function resolvePlan(parsed: ParsedBook, plan: ImportPlan): ResolvedPlan {
	const preview = plan;
	// 卷集合与顺序必须与解析产物一致（标题可改，增删卷不支持——移动章即可空出/填充卷）
	const expectedVolumeKeys = parsed.volumes.filter((v) => v.title !== null).map((v) => `v${v.no}`);
	const planVolumeKeys = preview.volumes.map((v) => v.key);
	if (expectedVolumeKeys.join(",") !== planVolumeKeys.join(",")) {
		throw new ImportError("IMP_INVALID_ARGUMENT", "导入计划与源文件解析结果不一致（卷结构），请重新预览");
	}
	const volumeIdByKey = new Map<string, string>();
	const volumes = preview.volumes.map((v, i) => {
		const title = v.title.trim();
		if (title.length === 0) {
			throw new ImportError("IMP_INVALID_ARGUMENT", `卷标题不能为空（${v.key}）`);
		}
		const volumeId = `imp-vol-${String(i + 1).padStart(2, "0")}`;
		volumeIdByKey.set(v.key, volumeId);
		return { key: v.key, title, volumeId };
	});

	// 章集合与顺序必须与解析产物一致（标题与归属卷可改）
	const flatten: Array<{ chapter: ParsedChapter; volumeKey: string | null }> = [];
	const volumeKeyOf = new Map<number, string>();
	for (const v of parsed.volumes) {
		if (v.title !== null) volumeKeyOf.set(v.no, `v${v.no}`);
	}
	for (const volume of parsed.volumes) {
		for (const chapter of volume.chapters) {
			flatten.push({ chapter, volumeKey: volumeKeyOf.get(volume.no) ?? null });
		}
	}
	if (flatten.length !== preview.chapters.length) {
		throw new ImportError("IMP_INVALID_ARGUMENT", "导入计划与源文件解析结果不一致（章数量），请重新预览");
	}
	const chapters: ResolvedChapter[] = preview.chapters.map((planChapter, i) => {
		const expected = flatten[i]!;
		if (planChapter.key !== `c${expected.chapter.no}`) {
			throw new ImportError("IMP_INVALID_ARGUMENT", "导入计划与源文件解析结果不一致（章顺序），请重新预览");
		}
		const title = planChapter.title.trim();
		if (title.length === 0) {
			throw new ImportError("IMP_INVALID_ARGUMENT", `章标题不能为空（${planChapter.key}）`);
		}
		if (
			planChapter.volumeKey !== null &&
			!volumeIdByKey.has(planChapter.volumeKey)
		) {
			throw new ImportError("IMP_INVALID_ARGUMENT", `章 ${planChapter.key} 归属了不存在的卷（${planChapter.volumeKey}）`);
		}
		return {
			key: planChapter.key,
			title,
			volumeKey: planChapter.volumeKey,
			batches: expected.chapter.batches,
		};
	});
	return { volumes, chapters };
}

/** 落库变更序列（锚点单元 → 全书根 saga → 卷 → 每章：段落插入 → 章创建） */
function buildMutations(resolved: ResolvedPlan, bookTitle: string): NovelMutation[] {
	const mutations: NovelMutation[] = [
		{
			op: "outline.storyUnit.create",
			id: IMPORT_ANCHOR_UNIT_ID,
			title: IMPORT_ANCHOR_UNIT_TITLE,
			scope: "custom",
			planningStatus: "ready",
			realizationStatus: "completed",
		},
		{
			op: "outline.storyUnit.create",
			id: IMPORT_SAGA_UNIT_ID,
			title: bookTitle,
			scope: "saga",
			orderKey: "0002" as OrderKey,
			planningStatus: "ready",
			realizationStatus: "completed",
		},
	];
	for (const volume of resolved.volumes) {
		mutations.push({
			op: "publication.volume.create",
			id: volume.volumeId,
			title: volume.title,
		});
	}
	let paragraphSeq = 0;
	let chapterSeq = 0;
	for (const chapter of resolved.chapters) {
		chapterSeq += 1;
		// 段落粒度 = 自然段（一段一句，对齐 Paragraph 模型；批次以空行连接自然段）
		const paragraphIds: string[] = [];
		for (const batch of chapter.batches) {
			for (const raw of batch.split("\n\n")) {
				const text = raw.trim();
				if (text.length === 0) continue;
				paragraphSeq += 1;
				const id = paragraphIdOf(paragraphSeq);
				paragraphIds.push(id);
				mutations.push({
					op: "paragraph.insert",
					id,
					storyUnitId: IMPORT_ANCHOR_UNIT_ID as StoryUnitId,
					text,
					// 导入正文无节奏标注：占位值（不影响正文展示；续写新段由 agent 正常标注）
					rhythm: "setup",
					intensity: 3,
				});
			}
		}
		mutations.push({
			op: "publication.chapter.create",
			id: `imp-ch-${String(chapterSeq).padStart(4, "0")}`,
			...(chapter.volumeKey !== null
				? { volumeId: volumeIdOfResolved(resolved, chapter.volumeKey) as PublicationVolumeId }
				: {}),
			title: chapter.title,
			paragraphIds: paragraphIds as ParagraphId[],
		});
	}
	return mutations;
}

/** 计划内卷 key → 卷 id */
function volumeIdOfResolved(resolved: ResolvedPlan, key: string): string {
	const hit = resolved.volumes.find((v) => v.key === key);
	if (hit === undefined) {
		throw new ImportError("IMP_INVALID_ARGUMENT", `章归属了不存在的卷（${key}）`);
	}
	return hit.volumeId;
}

/** 章全书序号（1 起） */
function manifestChapterNo(chapters: readonly ResolvedChapter[], key: string): number {
	const index = chapters.findIndex((c) => c.key === key);
	return index + 1;
}

/** 统计段落数（mutation 流中的 paragraph.insert 计数） */
function countParagraphs(mutations: readonly NovelMutation[]): number {
	return mutations.filter((m) => m.op === "paragraph.insert").length;
}

/** manifest 条数 */
async function countManifestEntries(workspaceRoot: string): Promise<number> {
	try {
		const raw = await readFile(importManifestPath(workspaceRoot), "utf8");
		return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
	} catch {
		return 0;
	}
}

/** 路径 → 安全源文件名（对齐书库规则） */
function sanitizeFileName(name: string): string {
	const cleaned = name.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "");
	return cleaned.length > 0 ? cleaned.slice(0, 120) : "import-source.txt";
}

/** 文件存在探测 */
async function existsFile(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}
