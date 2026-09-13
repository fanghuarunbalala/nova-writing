/**
 * 风格示例库（stylelib）类型与常量（PRD prose-gate-检索式形态示例 v0.2，生产端）：
 * 建库（导入后台步：manifest 分层抽样 → LLM 批量策展 → 子串硬校验 → 本地嵌入）
 * 与写作时检索注入共用的数据契约。常量为策展/检索参数的单一事实源。
 */

/** 风格标签枚举（策展 prompt 输出受控词表；非法标签丢弃） */
export const STYLE_TAGS: readonly string[] = Object.freeze([
	"对话吐槽",
	"环境白描",
	"打斗",
	"情绪爆发",
	"日常闲笔",
	"叙事推进",
]);

/** 候选段落组抽样目标（全书；不足则全取） */
export const CANDIDATE_TARGET = 1000;

/** 每次策展 LLM 调用喂的段落组数（全书 ≈ 候选 ÷ 本值次调用） */
export const CURATION_BATCH = 10;

/** 选段长度下限（短于该值的碎片跳过） */
export const MIN_PARA_LEN = 20;

/** 选段长度上限（超长段跳过——PRD O3 定参） */
export const MAX_PARA_LEN = 150;

/** RRF 融合常数（score = Σ 1/(K + rank)） */
export const RRF_K = 60;

/** 向量路召回条数 */
export const VECTOR_TOP_K = 8;

/** 关键字路召回条数 */
export const KEYWORD_TOP_N = 16;

/** 单次注入条数（top-K 段） */
export const INJECT_TOP_K = 2;

/** 示例库条目（analysis/stylelib.json 的 paragraphs 元素） */
export interface StylelibEntry {
	/** 库内段 id（`<bookId>-sl-<4位序>`，建库时顺序编号；一批可出多段故独立于 paragraphId） */
	readonly id: string;
	/** 溯源分段 id（manifest 的 `<bookId>-p<6位序>`） */
	readonly paragraphId: string;
	/** 章序（全书连续） */
	readonly chapterNo: number;
	/** 段原文（经子串硬校验——策展必须整段照抄，防 LLM 改写） */
	readonly text: string;
	/** 风格标签（STYLE_TAGS 之一） */
	readonly styleTag: string;
	/** 场景召回关键字（3-6 个：场景类型词 + 关键物象） */
	readonly keywords: readonly string[];
}

/** 策展解析丢弃计数（建库质量观测） */
export interface StylelibDropped {
	/** 非原文子串（疑似改写） */
	readonly notSubstring: number;
	/** 超长（> MAX_PARA_LEN） */
	readonly tooLong: number;
	/** 过短（< MIN_PARA_LEN） */
	readonly tooShort: number;
	/** 风格标签非法 */
	readonly badTag: number;
	/** 组序号越界 */
	readonly badGroup: number;
	/** 同组同段重复 */
	readonly duplicate: number;
}

/** 建库统计（stylelib.json stats + runner 上报） */
export interface StylelibBuildStats {
	/** 候选段落组数 */
	readonly candidates: number;
	/** 策展调用次数（含重试前批次；= ceil(candidates / CURATION_BATCH)） */
	readonly batches: number;
	/** 策展调用失败批次数（重试一次仍失败；该批产出放弃，不阻断建库） */
	readonly failedBatches: number;
	/** 入库段数 */
	readonly kept: number;
	/** 丢弃计数 */
	readonly dropped: StylelibDropped;
	/** 标签分布（标签 → 段数） */
	readonly tags: Readonly<Record<string, number>>;
	/** 无向量建库（嵌入模型缺失 → 检索降级纯关键字） */
	readonly vectorless: boolean;
}

/** 示例库文档（analysis/stylelib.json 整体形状） */
export interface StylelibDoc {
	/** 契约版本 */
	readonly schema: 1;
	/** 书 id */
	readonly bookId: string;
	/** 建库时间（ISO） */
	readonly builtAt: string;
	/** 策展模型名 */
	readonly model: string;
	/** 建库统计 */
	readonly stats: StylelibBuildStats;
	/** 段条目（与 stylelib.emb 行序严格一致；两文件同次重建一起写） */
	readonly paragraphs: readonly StylelibEntry[];
}

/** book.meta.json 的 stylelib 状态字段（导入后台建库步维护） */
export interface StylelibStatus {
	/** 建库状态 */
	readonly status: "未建" | "建库中" | "已建" | "失败";
	/** 入库段数（已建时） */
	readonly count?: number;
	/** 建库时间（ISO；已建时） */
	readonly builtAt?: string;
	/** 无向量建库标记（嵌入模型缺失） */
	readonly vectorless?: boolean;
	/** 失败原因（截断 500 字） */
	readonly reason?: string;
}

/** 生成的库内段 id（`<bookId>-sl-<4位序>`） */
export function stylelibIdOf(bookId: string, seq: number): string {
	return `${bookId}-sl-${String(seq).padStart(4, "0")}`;
}
