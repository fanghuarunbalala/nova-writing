/**
 * 夹具包构建核心（F1）：book txt → 确定性解析（core parseBookText，免 key）→ book.json。
 * 幂等：source 哈希一致跳过；不一致要求 --force（force 只重建解析层，自造产物与
 * ground-truth 保留不动）。构建期校验：ground-truth 引用的 pid 必须存在、
 * entities 种子可落库（防作者期形状错误漏到 run 期）。
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { InMemoryNovelStore, parseBookText } from "@novel/core";
import type { NovelMutation } from "@novel/core";
import {
	extractPids,
	paragraphIdOf,
	type FixtureBookJson,
	type FixtureParagraph,
} from "./pack.js";

export interface BuildFixtureOptions {
	sourcePath: string;
	alias: string;
	/** 夹具根（缺省 fixtureBooksRoot()） */
	root?: string;
	force?: boolean;
	/** 书名（缺省取别名） */
	title?: string;
}

export interface BuildFixtureResult {
	dir: string;
	/** 首次创建（写了模板）；false = 幂等跳过或 force 重建 */
	created: boolean;
	/** force 重建解析层 */
	rebuilt: boolean;
	book: FixtureBookJson;
}

const ALIAS_RE = /^[a-z0-9][a-z0-9-]*$/;

function sha256(s: string): string {
	return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 解析层构建：卷章骨架 + 分段清单（pid 按全书顺序递增） */
export function buildBookJson(text: string, alias: string, title: string): FixtureBookJson {
	const parsed = parseBookText(text);
	const paragraphs: FixtureParagraph[] = [];
	const volumes = parsed.volumes.map((v) => ({
		no: v.no,
		title: v.title,
		chapters: v.chapters.map((c) => {
			const batchIds = c.batches.map((batch) => {
				const id = paragraphIdOf(alias, paragraphs.length + 1);
				paragraphs.push({
					id,
					chapterNo: c.no,
					chapterTitle: c.title,
					chars: batch.length,
					text: batch,
				});
				return id;
			});
			return { no: c.no, title: c.title, batchIds };
		}),
	}));
	return {
		schema: 1,
		alias,
		title,
		sourceSha256: sha256(text),
		builtAt: new Date().toISOString(),
		stats: {
			volumes: volumes.length,
			chapters: paragraphs.length > 0 ? Math.max(...paragraphs.map((p) => p.chapterNo)) : 0,
			batches: paragraphs.length,
			chars: paragraphs.reduce((sum, p) => sum + p.chars, 0),
		},
		volumes,
		paragraphs,
	};
}

/** ground-truth 文本中引用的全部 pid（扫描字符串值即可——pid 是唯一锚点） */
function pidsReferencedIn(text: string, alias: string): string[] {
	return extractPids(text, alias);
}

/** 卷章骨架 + 自造实体一起试落库（形状非法在构建期暴露） */
export async function validateEntities(
	book: FixtureBookJson,
	entities: readonly NovelMutation[],
): Promise<void> {
	const skeleton: NovelMutation[] = [];
	for (const v of book.volumes) {
		const volumeId = `${book.alias}-vol${String(v.no).padStart(2, "0")}`;
		skeleton.push({
			op: "publication.volume.create",
			id: volumeId,
			title: v.title ?? `第${v.no}卷`,
		});
		for (const c of v.chapters) {
			skeleton.push({
				op: "publication.chapter.create",
				id: `${book.alias}-ch${String(c.no).padStart(4, "0")}`,
				title: c.title,
				volumeId: volumeId as never,
			});
		}
	}
	const store = new InMemoryNovelStore();
	await store.mutateBatch([...skeleton, ...entities]);
}

/** 构建（或幂等校验）一个夹具包目录 */
export async function buildFixturePackDir(opts: BuildFixtureOptions): Promise<BuildFixtureResult> {
	const { sourcePath, alias, force } = opts;
	if (!ALIAS_RE.test(alias)) {
		throw new Error(`别名非法：${alias}（kebab-case：小写字母/数字/连字符）`);
	}
	const root = opts.root ?? process.env.NOVEL_EVAL_FIXTURES ?? join(process.cwd(), "fixtures", "books");
	const dir = join(root, alias);
	const bookPath = join(dir, "book.json");

	let text: string;
	try {
		text = await readFile(sourcePath, "utf8");
	} catch (e) {
		throw new Error(`源文件不可读：${sourcePath}（${e instanceof Error ? e.message : String(e)}）`);
	}
	if (text.trim().length === 0) {
		throw new Error("书本内容为空（未识别到任何正文）");
	}
	const title = opts.title ?? alias;

	// 幂等 / force 决策
	const wasExisting = existsSync(bookPath);
	if (wasExisting) {
		const existing = JSON.parse(await readFile(bookPath, "utf8")) as FixtureBookJson;
		if (existing.sourceSha256 === sha256(text) && !force) {
			await validateFixtureDir(dir, existing);
			return { dir, created: false, rebuilt: false, book: existing };
		}
		if (existing.sourceSha256 !== sha256(text) && !force) {
			throw new Error(
				`别名 ${alias} 已存在且 source 哈希不一致（解析层将变）——加 --force 显式重建`,
			);
		}
	}

	const book = buildBookJson(text, alias, title);
	await mkdir(join(dir, "fabricated"), { recursive: true });
	await copyFile(sourcePath, join(dir, "source.txt")).catch(async () => {
		// 源与目标同路径（就地重建）时 copyFile 自伤——改写文本
		await writeFile(join(dir, "source.txt"), text, "utf8");
	});
	await writeFile(bookPath, JSON.stringify(book, null, 2), "utf8");

	// 逐文件缺件补模板（作者预写的任何文件——含仅预写 entities 而无 ground-truth 的
	// 组合——一律保留，不被模板覆盖）
	await writeTemplates(dir, alias, title, book);
	await validateFixtureDir(dir, book);
	return { dir, created: !wasExisting, rebuilt: wasExisting && force === true, book };
}

async function writeIfMissing(path: string, content: string): Promise<void> {
	if (!existsSync(path)) {
		await writeFile(path, content, "utf8");
	}
}

async function writeTemplates(
	dir: string,
	alias: string,
	title: string,
	book: FixtureBookJson,
): Promise<void> {
	const firstPid = book.paragraphs[0]?.id ?? paragraphIdOf(alias, 1);
	await writeIfMissing(
		join(dir, "fabricated", "style.md"),
		[
			`# 《${title}》风格分析（自造产物模板）`,
			"",
			"<!-- 逐条结论附 paragraph id 例证；本文件为静态冻结产物，评测运行零 LLM 依赖 -->",
			`- 短句为主，动词密集，善用天气与灯火意象（例证：${firstPid}）。`,
			"",
		].join("\n"),
	);
	await writeIfMissing(
		join(dir, "fabricated", "excerpts.md"),
		[
			`# 《${title}》特色原文摘录（自造产物模板）`,
			"",
			`## ${firstPid} 开篇定调`,
			"> （≤300 字原文摘录，替换为本章代表性段落）",
			"",
			"代表性：……",
			"",
		].join("\n"),
	);
	await writeIfMissing(
		join(dir, "fabricated", "entities.json"),
		JSON.stringify({ mutations: [] }, null, 2),
	);
	await writeIfMissing(
		join(dir, "ground-truth.json"),
		JSON.stringify(
			{
				schema: 1,
				title,
				notes: "参考答案锚点：pid 必须真实存在（构建期校验）。探针位置供二期 case 使用。",
				foreshadows: [
					{
						desc: "（伏笔：埋设与回收位置）",
						plantPids: [firstPid],
						payoffPids: [firstPid],
					},
				],
				contradictions: [
					{
						desc: "（设定矛盾：同一事实两侧冲突）",
						sides: [
							{ claim: "（设定 A）", pids: [firstPid] },
							{ claim: "（设定 B，与 A 冲突）", pids: [firstPid] },
						],
					},
				],
				characterFacts: [{ name: "（人物）", facts: ["（关键事实）"], pids: [firstPid] }],
				singleSegmentDetails: [
					{ desc: "（仅存在于单一分段的细节）", pids: [firstPid], answer: "（答案）" },
				],
				chapterArcs: [{ chapterNo: 1, events: ["（本章关键事件）"] }],
			},
			null,
			2,
		),
	);
}

/** 目录级校验：ground-truth pid 存在性 + entities 落库形状 */
async function validateFixtureDir(dir: string, book: FixtureBookJson): Promise<void> {
	const groundTruthPath = join(dir, "ground-truth.json");
	if (existsSync(groundTruthPath)) {
		const raw = await readFile(groundTruthPath, "utf8");
		const referenced = pidsReferencedIn(raw, book.alias);
		const valid = new Set(book.paragraphs.map((p) => p.id));
		const dangling = referenced.filter((id) => !valid.has(id));
		if (dangling.length > 0) {
			throw new Error(
				`ground-truth 引用了不存在的 pid：${dangling.slice(0, 5).join(", ")}${dangling.length > 5 ? " 等" : ""}（force 重建后分段编号可能已变——请同步修订 ground-truth.json）`,
			);
		}
	}
	const entitiesPath = join(dir, "fabricated", "entities.json");
	if (existsSync(entitiesPath)) {
		const entities = (
			JSON.parse(await readFile(entitiesPath, "utf8")) as { mutations?: unknown }
		).mutations as NovelMutation[] | undefined;
		if (entities !== undefined) {
			await validateEntities(book, entities);
		}
	}
}
