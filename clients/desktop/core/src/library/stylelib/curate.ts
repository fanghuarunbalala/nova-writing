/**
 * LLM 批量策展（PRD F1）：每次喂 CURATION_BATCH 个段落组，横向比较挑真正强风格段。
 * 每组可出 0-2 段、整批空选合法（不强制每组产出）；text 必须整段原文照抄——解析侧
 * 子串硬校验拒改写。策展调用由调用方（build.ts）经注入的 provider 直连发起
 * （LlmIntentClassifier 同款），本模块只做 prompt 构造与解析校验（纯函数，可测）。
 */
import type { ParagraphManifestEntry } from "../LibraryService.js";
import { MAX_PARA_LEN, MIN_PARA_LEN, STYLE_TAGS } from "./types.js";

/** 策展系统提示（只输出 JSON） */
export const CURATION_SYSTEM = [
	"你是网文风格策展人。从给定的段落组中挑出真正具有强烈风格的段落。",
	"只输出 JSON，不加任何解释。",
].join("");

/** 策展段落组（manifest 条目 + 批文件拆出的自然段） */
export interface CurateGroup {
	/** 组序（prompt 内 1 起；selections.group 回溯用） */
	readonly no: number;
	/** manifest 条目（id / 章归属 / 批文件） */
	readonly entry: ParagraphManifestEntry;
	/** 原文自然段（批文件按空行拆分；策展从中选段） */
	readonly paragraphs: readonly string[];
	/** 批文件全文（子串校验兜底基准） */
	readonly batchText: string;
}

/** 解析产出（未编号；build.ts 统一排序编号） */
export interface CuratePick {
	/** 溯源分段 id */
	readonly paragraphId: string;
	/** 章序 */
	readonly chapterNo: number;
	/** 段原文（已过子串硬校验） */
	readonly text: string;
	/** 风格标签（已过枚举校验） */
	readonly styleTag: string;
	/** 场景关键字（已清洗） */
	readonly keywords: readonly string[];
}

/** 解析结果：产出 + 丢弃计数 */
export interface CurateParseResult {
	readonly picks: readonly CuratePick[];
	readonly dropped: {
		readonly notSubstring: number;
		readonly tooLong: number;
		readonly tooShort: number;
		readonly badTag: number;
		readonly badGroup: number;
		readonly duplicate: number;
	};
}

/**
 * 构造策展 prompt（一次调用 = 一批段落组的筛选 + 标签 + 关键字）
 * @param groups 本批段落组（组序即数组序 + 1）
 * @returns user prompt 文本
 */
export function buildCurationPrompt(groups: readonly CurateGroup[]): string {
	const blocks = groups.map((g) => {
		const paras = g.paragraphs
			.map((p, i) => `${i + 1}. ${p}`)
			.join("\n");
		return `【组 ${g.no}】${g.entry.id}（第 ${g.entry.chapterNo} 章·${g.entry.chapterTitle}）\n${paras}`;
	});
	return [
		"从下面的段落组中横向比较，挑出真正具有强烈风格的段落（对话灵动 / 白描有味 / 节奏鲜明 / 情绪有张力）。",
		"",
		"【纪律】",
		"- 每组最多选 2 段；没有强风格段就不选——允许整批全不选，不强求每组都有产出",
		"- text 必须是所选段落的原文整段照抄：不得改写、不得拼接、不得增删字",
		`- styleTag 只能取：${STYLE_TAGS.join(" / ")}`,
		'- keywords 是场景召回词（3-6 个）：场景类型词 + 关键物象（如 "对峙" "雨夜" "茶馆" "初见" "拆招"）',
		"",
		"【段落组】",
		blocks.join("\n\n"),
		"",
		'只输出 JSON：{"selections": [{"group": 1, "text": "整段原文照抄", "styleTag": "对话吐槽", "keywords": ["…", "…"]}]}',
	].join("\n");
}

/** 压空白归一（子串校验基准：忽略全部空白差异，防换行/空格造成的假阴性） */
function normalizeText(text: string): string {
	return text.replace(/\s+/g, "");
}

/**
 * 解析策展回复 → 产出 + 丢弃计数（容错：剥围栏、截取首个 JSON 对象、逐条独立校验）
 * @param reply 模型输出原文
 * @param groups 本批段落组（组序回溯 + 子串基准）
 * @returns 解析结果（坏回复 → 空 picks + 零丢弃计数，不抛错）
 */
export function parseCuration(
	reply: string,
	groups: readonly CurateGroup[],
): CurateParseResult {
	const dropped = { notSubstring: 0, tooLong: 0, tooShort: 0, badTag: 0, badGroup: 0, duplicate: 0 };
	const byNo = new Map<number, CurateGroup>();
	for (const g of groups) byNo.set(g.no, g);
	const selections = extractSelections(reply);
	if (selections === undefined) return { picks: [], dropped };
	const picks: CuratePick[] = [];
	const seen = new Set<string>();
	for (const raw of selections) {
		const no = raw.group;
		const group = typeof no === "number" ? byNo.get(no) : undefined;
		if (group === undefined) {
			dropped.badGroup += 1;
			continue;
		}
		const text = typeof raw.text === "string" ? raw.text.trim() : "";
		if (text.length === 0) {
			dropped.notSubstring += 1;
			continue;
		}
		if (text.length > MAX_PARA_LEN) {
			dropped.tooLong += 1;
			continue;
		}
		if (text.length < MIN_PARA_LEN) {
			dropped.tooShort += 1;
			continue;
		}
		if (typeof raw.styleTag !== "string" || !STYLE_TAGS.includes(raw.styleTag)) {
			dropped.badTag += 1;
			continue;
		}
		// 子串硬校验：先「等于某自然段」（归一空白），退而「为批文子串」，再不行丢弃
		const norm = normalizeText(text);
		const exact = group.paragraphs.some((p) => normalizeText(p) === norm);
		const substring = exact || normalizeText(group.batchText).includes(norm);
		if (!substring) {
			dropped.notSubstring += 1;
			continue;
		}
		const dedupeKey = `${group.no}:${norm}`;
		if (seen.has(dedupeKey)) {
			dropped.duplicate += 1;
			continue;
		}
		seen.add(dedupeKey);
		picks.push({
			paragraphId: group.entry.id,
			chapterNo: group.entry.chapterNo,
			text,
			styleTag: raw.styleTag,
			keywords: sanitizeKeywords(raw.keywords),
		});
	}
	return { picks, dropped };
}

/** 原始 selection 形状（未校验） */
interface RawSelection {
	group?: unknown;
	text?: unknown;
	styleTag?: unknown;
	keywords?: unknown;
}

/** 容错提取 selections 数组（剥 ``` 围栏 → 直接 parse → 截取首个 { 到末个 }） */
function extractSelections(reply: string): readonly RawSelection[] | undefined {
	const trimmed = reply
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/, "")
		.trim();
	const candidates = [trimmed];
	const first = trimmed.indexOf("{");
	const last = trimmed.lastIndexOf("}");
	if (first >= 0 && last > first) {
		candidates.push(trimmed.slice(first, last + 1));
	}
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as { selections?: unknown };
			if (Array.isArray(parsed.selections)) {
				return parsed.selections as RawSelection[];
			}
		} catch {
			// 尝试下一个候选
		}
	}
	return undefined;
}

/** 关键字清洗：留非空字符串、去重、截前 6 个 */
function sanitizeKeywords(raw: unknown): readonly string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const keyword = item.trim();
		if (keyword.length === 0 || out.includes(keyword)) continue;
		out.push(keyword);
		if (out.length >= 6) break;
	}
	return out;
}
