/**
 * 宿主确定性书本解析器（纯函数，不经 LLM）：切卷/切章 + 章内段落聚合分批。
 * 产出仅确定性结构——卷/章/分段文本；大纲（story unit）零产出（叙事判断归
 * BookAnalyst，见 PRD library-完本解构 F2 与 docs/development/域模型规范.md）。
 */

/** 解析出的卷（发布单位；无卷标记时全书一卷、title 为 null） */
export interface ParsedVolume {
	/** 卷序（1 起） */
	readonly no: number;
	/** 卷标题（原文卷标记行；无标记为 null） */
	readonly title: string | null;
	/** 卷内章节 */
	readonly chapters: readonly ParsedChapter[];
}

/** 解析出的章（发布单位；章标题行确定性识别） */
export interface ParsedChapter {
	/** 章序（全书 1 起连续） */
	readonly no: number;
	/** 章标题（识别出的标题行文本；虚拟章为「第 N 部分」） */
	readonly title: string;
	/** 章内分段批次（每批 = 自然段聚合，目标 3000–4000 字、硬上限 6000 字） */
	readonly batches: readonly string[];
}

/** 解析结果：卷 → 章 → 分批正文 */
export interface ParsedBook {
	/** 卷列表（至少一卷） */
	readonly volumes: readonly ParsedVolume[];
	/** 全书自然段总数 */
	readonly totalParagraphCount: number;
	/** 全书字符数（去空白前原文长度） */
	readonly totalChars: number;
}

/** 分批目标字数（达到即收批） */
const BATCH_TARGET_CHARS = 3500;

/** 分批硬上限（超过即强制收批；单自然段超限时独占一批并放行） */
const BATCH_MAX_CHARS = 6000;

/** 无章标记时的虚拟切章目标字数 */
const VIRTUAL_CHAPTER_CHARS = 8000;

/** 卷标记行（第N卷 / Volume N） */
const VOLUME_LINE_RE =
	/^\s*(第[0-9零一二三四五六七八九十百千万两]+卷|Volume\s+\d+|卷[0-9零一二三四五六七八九十百千万两]+)\s*(.*)$/;

/** 章标记行（第N章/回/节、Chapter N、序章/楔子/尾声/终章/番外） */
const CHAPTER_LINE_RE =
	/^\s*(第[0-9零一二三四五六七八九十百千万两]+[章回节]|Chapter\s+\d+|序章|楔子|尾声|终章|番外\S*)\s*(.*)$/;

/**
 * 解析书本全文为确定性结构（卷/章/分批）
 * @param text 全文（UTF-8）
 * @returns 解析结果（至少一卷一章一批）
 */
export function parseBookText(text: string): ParsedBook {
	const lines = text.split(/\r?\n/);
	type RawVolume = { title: string | null; chapters: RawChapter[] };
	const volumes: RawVolume[] = [];
	let currentVolume: RawVolume | null = null;
	let currentChapter: RawChapter | null = null;
	let chapterSeq = 0;
	let sawChapterMarker = false;

	/** 开新卷（当前章清空，正文归后续章） */
	const openVolume = (title: string | null): RawVolume => {
		const volume: RawVolume = { title, chapters: [] };
		volumes.push(volume);
		currentVolume = volume;
		currentChapter = null;
		return volume;
	};
	/** 开新章 */
	const openChapter = (title: string): RawChapter => {
		const volume = currentVolume ?? openVolume(null);
		const chapter: RawChapter = { title, lines: [] };
		volume.chapters.push(chapter);
		currentChapter = chapter;
		chapterSeq += 1;
		return chapter;
	};

	for (const line of lines) {
		const vol = VOLUME_LINE_RE.exec(line);
		if (vol !== null) {
			const title = vol[0].trim();
			openVolume(title.length > 0 ? title : null);
			continue;
		}
		const ch = CHAPTER_LINE_RE.exec(line);
		if (ch !== null) {
			sawChapterMarker = true;
			const title = ch[0].trim();
			const chapter = openChapter(title.length > 0 ? title : `第 ${chapterSeq + 1} 部分`);
			// 章标记行同行余文作为首个自然段
			const rest = ch[2] ?? "";
			if (rest.trim().length > 0) {
				chapter.lines.push(rest);
			}
			continue;
		}
		const chapter = currentChapter ?? openChapter("开篇");
		chapter.lines.push(line);
	}

	if (volumes.length === 0 || volumes.every((v) => v.chapters.length === 0)) {
		throw new Error("书本内容为空（未识别到任何正文）");
	}

	// 全书无任何章标记 → 按字数虚拟切章（段边界对齐）
	if (!sawChapterMarker) {
		return buildVirtualResult(
			volumes.flatMap((v) => v.chapters.flatMap((c) => c.lines)),
			text,
		);
	}

	const outVolumes: ParsedVolume[] = [];
	let chapterNo = 0;
	for (const v of volumes) {
		const chapters: ParsedChapter[] = v.chapters.map((c) => {
			chapterNo += 1;
			return { no: chapterNo, title: c.title, batches: batchParagraphs(c.lines) };
		});
		outVolumes.push({ no: outVolumes.length + 1, title: v.title, chapters });
	}
	return {
		volumes: outVolumes,
		totalParagraphCount: countParagraphs(text),
		totalChars: text.length,
	};
}

/** 中间类型别名（章原始形态） */
type RawChapter = { title: string; lines: string[] };

/**
 * 自然段聚合分批：目标 3500 收批、6000 硬上限；段边界对齐（不切自然段）
 * @param lines 章内原始行
 * @returns 分批文本（每批自然段以空行连接）
 */
function batchParagraphs(lines: readonly string[]): string[] {
	const paragraphs = splitNaturalParagraphs(lines);
	const batches: string[] = [];
	let current: string[] = [];
	let currentChars = 0;
	for (const para of paragraphs) {
		const paraChars = para.length;
		if (current.length > 0 && currentChars + paraChars > BATCH_MAX_CHARS) {
			batches.push(current.join("\n\n"));
			current = [];
			currentChars = 0;
		}
		current.push(para);
		currentChars += paraChars;
		if (currentChars >= BATCH_TARGET_CHARS) {
			batches.push(current.join("\n\n"));
			current = [];
			currentChars = 0;
		}
	}
	if (current.length > 0) batches.push(current.join("\n\n"));
	return batches;
}

/**
 * 原始行 → 自然段（行=段：非空行即一个自然段——中文网文 txt 的主流格式；
 * 分批时以空行连接保持段边界）
 * @param lines 原始行
 * @returns 自然段列表
 */
function splitNaturalParagraphs(lines: readonly string[]): string[] {
	return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

/**
 * 无章标记的虚拟切章结果（按字数切段、段边界对齐）
 * @param lines 全书原始行
 * @param text 原文（统计用）
 * @returns 解析结果
 */
function buildVirtualResult(lines: readonly string[], text: string): ParsedBook {
	const paragraphs = splitNaturalParagraphs(lines);
	const chapters: RawChapter[] = [];
	let current: string[] = [];
	let currentChars = 0;
	let seq = 0;
	for (const para of paragraphs) {
		if (current.length > 0 && currentChars + para.length > VIRTUAL_CHAPTER_CHARS) {
			seq += 1;
			chapters.push({ title: `第 ${seq} 部分`, lines: [...current] });
			current = [];
			currentChars = 0;
		}
		current.push(para);
		currentChars += para.length;
	}
	if (current.length > 0) {
		seq += 1;
		chapters.push({ title: `第 ${seq} 部分`, lines: [...current] });
	}
	if (chapters.length === 0) throw new Error("书本内容为空（未识别到任何正文）");
	return {
		volumes: [
			{
				no: 1,
				title: null,
				chapters: chapters.map((c, i) => ({
					no: i + 1,
					title: c.title,
					batches: batchParagraphs(c.lines),
				})),
			},
		],
		totalParagraphCount: paragraphs.length,
		totalChars: text.length,
	};
}

/**
 * 统计全书自然段数（非空行块计数）
 * @param text 原文
 * @returns 自然段总数
 */
function countParagraphs(text: string): number {
	return splitNaturalParagraphs(text.split(/\r?\n/)).length;
}
