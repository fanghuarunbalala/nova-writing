/**
 * 书库夹具包（docs/PRD/evals-书库真实评测.md F1）：mock 引擎的静态数据源。
 * 一书一目录 `fixtures/books/<别名>/`——解析层（book.json，确定性生成免 key）+
 * 自造产物（fabricated/，人工或一次性 LLM 辅助后冻结）+ 参考答案锚点（ground-truth.json）。
 * 真实书 gitignore 不入仓库；合成书（ywjs）随仓库提交保证任何环境免 key 复现。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { NovelMutation } from "@novel/core";

/** 夹具分段（与生产 readParagraphs 返回项同构；id 契约 `<别名>-p<6位>`） */
export interface FixtureParagraph {
	id: string;
	chapterNo: number;
	chapterTitle: string;
	chars: number;
	text: string;
}

/** book.json 结构（解析层，fixture:build 确定性生成） */
export interface FixtureBookJson {
	schema: 1;
	alias: string;
	title: string;
	/** 源文本 sha256（幂等键：一致则跳过重建） */
	sourceSha256: string;
	/** 构建时间（ISO；BookSummary 的 createdAt/updatedAt 取此值） */
	builtAt: string;
	stats: { volumes: number; chapters: number; batches: number; chars: number };
	volumes: ReadonlyArray<{
		no: number;
		title: string | null;
		chapters: ReadonlyArray<{ no: number; title: string; batchIds: readonly string[] }>;
	}>;
	/** 全书分段（按卷章顺序、pid 全书递增） */
	paragraphs: readonly FixtureParagraph[];
}

/** 加载后的完整夹具包（fabricated 缺文件时为 null/空——实体落库在首次 openBookStore 报错暴露） */
export interface BookFixturePack {
	alias: string;
	title: string;
	dir: string;
	book: FixtureBookJson;
	paragraphs: readonly FixtureParagraph[];
	/** 全书合法 pid 集合（ground-truth 校验与引用兜底用） */
	validParagraphIds: Set<string>;
	fabricated: {
		style: string | null;
		excerpt: string | null;
		entities: readonly NovelMutation[];
	};
	/** ground-truth.json 解析结果（无则为 null）；结构由 case 自行约定 */
	groundTruth: unknown;
}

/** 夹具根目录（env 可覆盖；缺省 <cwd>/fixtures/books——pnpm --filter 下 cwd = evals 包根） */
export function fixtureBooksRoot(): string {
	return process.env.NOVEL_EVAL_FIXTURES ?? join(process.cwd(), "fixtures", "books");
}

/** pid 构造（对齐生产 `<bookId>-p<6位>` 契约） */
export function paragraphIdOf(alias: string, seq: number): string {
	return `${alias}-p${String(seq).padStart(6, "0")}`;
}

/** 某章全部分段 id（续写题的「原书下一章」参考区间即由此取） */
export function paragraphIdsOfChapter(pack: BookFixturePack, chapterNo: number): string[] {
	return pack.paragraphs.filter((p) => p.chapterNo === chapterNo).map((p) => p.id);
}

/** 从任意文本提取该书全部 pid 引用（citations 与返回集合提取共用） */
export function extractPids(text: string, alias: string): string[] {
	return [...text.matchAll(new RegExp(`${alias}-p\\d{6}`, "g"))].map((m) => m[0]);
}

/**
 * 加载夹具包（book.json 必在；fabricated/ground-truth 可缺——模板未填）。
 * 缺书抛明确错误（对齐 F13「case 构造期报错，不进执行」——不静默跳过）。
 */
export async function loadBookFixture(
	alias: string,
	root: string = fixtureBooksRoot(),
): Promise<BookFixturePack> {
	const dir = join(root, alias);
	const bookPath = join(dir, "book.json");
	if (!existsSync(bookPath)) {
		throw new Error(
			`书库夹具包缺失：${bookPath}（先运行 pnpm --filter @novel/evals fixture:build -- <txt> ${alias}）`,
		);
	}
	const book = JSON.parse(await readFile(bookPath, "utf8")) as FixtureBookJson;
	if (book.alias !== alias) {
		throw new Error(`夹具包别名不一致：目录 ${alias}，book.json 声明 ${book.alias}`);
	}
	const stylePath = join(dir, "fabricated", "style.md");
	const excerptPath = join(dir, "fabricated", "excerpts.md");
	const entitiesPath = join(dir, "fabricated", "entities.json");
	const groundTruthPath = join(dir, "ground-truth.json");
	const entities = existsSync(entitiesPath)
		? ((JSON.parse(await readFile(entitiesPath, "utf8")) as { mutations?: unknown }).mutations ??
			[]) as NovelMutation[]
		: [];
	return {
		alias,
		title: book.title,
		dir,
		book,
		paragraphs: book.paragraphs,
		validParagraphIds: new Set(book.paragraphs.map((p) => p.id)),
		fabricated: {
			style: existsSync(stylePath) ? await readFile(stylePath, "utf8") : null,
			excerpt: existsSync(excerptPath) ? await readFile(excerptPath, "utf8") : null,
			entities,
		},
		groundTruth: existsSync(groundTruthPath)
			? (JSON.parse(await readFile(groundTruthPath, "utf8")) as unknown)
			: null,
	};
}
