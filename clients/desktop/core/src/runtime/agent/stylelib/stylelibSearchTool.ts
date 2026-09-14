/**
 * StylelibSearch 延迟工具（PRD 检索式形态示例 F3 工具通道）：agent 经
 * runtime.external 两步（SearchExtraTools 发现 → ExecuteExtraTool 执行）主动检索
 * 当前写作参考书的风格示例库——自动注入（novel.stylelib 段 / Compose seed）之外的
 * 按需通道，查更多/更定向的形态范例。受信只读（无 requireApproval，经
 * ExecuteExtraTool 免审直执行）；与自动注入同一开关装配（默认关，关时不入池）。
 * description 是唯一展示面（延迟工具的 promptDetail 不渲染），须自足。
 */
import {
	loadStylelibIndex,
	resolveStylelibBook,
	retrieve,
} from "../../../library/stylelib/retrieve.js";
import type { EmbeddingProvider } from "../../../library/stylelib/embed.js";
import { STYLE_TAGS } from "../../../library/stylelib/types.js";
import type { Logger } from "../../../log/Logger.js";
import { ToolError } from "../../tool/errors.js";
import type { ToolDef } from "../../tool/ToolDef.js";
import { createLazyEmbedder } from "./stylelibProvider.js";

/** 工具构造依赖（entrypoint 组装；测试可注入 fake embedder/logger） */
export interface StylelibSearchToolDeps {
	/** 书库根（NOVEL_LIBRARY_ROOT） */
	readonly libraryRoot: string;
	/** 工作区根（.novel/library.json 书单定位参考书） */
	readonly workspace: string;
	/** 嵌入提供者（缺省懒建 Onnx 单例，与注入 provider/seed 共享创建逻辑） */
	readonly embed?: EmbeddingProvider;
	/** 结构化日志（缺省静默） */
	readonly logger?: Logger;
}

/** 单次返回上限（token 护栏） */
const RESULT_MAX = 10;
const RESULT_DEFAULT = 5;

/**
 * 创建 StylelibSearch 工具
 * @param deps 构造依赖
 * @returns ToolDef（进 DeferredToolRegistry 延迟池，不进常驻工具面）
 */
export function createStylelibSearchTool(deps: StylelibSearchToolDeps): ToolDef {
	const embedder = createLazyEmbedder(deps);
	return {
		name: "StylelibSearch",
		version: "1.0.0",
		description: [
			"检索当前写作参考书的「风格示例库」：按场景/情绪/物象关键词查强风格原文段落（few-shot 形态范例），返回段落原文 + 风格标签 + 场景关键字 + 来源章。",
			"用途：写正文/场景设计前，主动查贴近当前场景的形态范例（自动注入只给 top-2，本工具可查更多、可按标签定向，如 style_tag=环境白描 只看白描段）。",
			"调用方式：先 SearchExtraTools 发现本工具，再 ExecuteExtraTool({tool_name: \"StylelibSearch\", params: {query, style_tag?, limit?}})。",
			"纪律：范例仅示范段落节奏与叙述腔，禁止复用其内容词句。",
		].join("\n"),
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "查询词：场景类型 / 情绪 / 物象关键词（如「雨夜街道白描」「寝室闲聊调侃」「擂台对峙」）",
				},
				style_tag: {
					type: "string",
					enum: [...STYLE_TAGS],
					description: "风格标签过滤（可选）：对话吐槽 / 环境白描 / 打斗 / 情绪爆发 / 日常闲笔 / 叙事推进",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: RESULT_MAX,
					description: "返回条数（可选，缺省 5，上限 10）",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		handler: {
			execute: async (call) => {
				const args = parseArgs(call);
				const query = args.query.trim();
				if (query.length === 0) {
					throw new ToolError(
						{ code: "TOOL_ARGUMENTS_INVALID", toolName: "StylelibSearch" },
						"query 不能为空：给场景/情绪/物象关键词（如「雨夜街道白描」）",
					);
				}
				const limit = clamp(args.limit ?? RESULT_DEFAULT, 1, RESULT_MAX);
				const onlyTags =
					args.style_tag !== undefined && STYLE_TAGS.includes(args.style_tag)
						? [args.style_tag]
						: undefined;
				const bookId = await resolveStylelibBook(deps.libraryRoot, deps.workspace);
				if (bookId === undefined) {
					return "当前工作区无可用的风格示例库（书单未授权参考书，或该书尚未建库——导入完本后自动建库，见 book.meta.json 的 stylelib 状态）。";
				}
				const index = await loadStylelibIndex(deps.libraryRoot, bookId);
				if (index === undefined || index.doc.paragraphs.length === 0) {
					return `参考书 ${bookId} 的风格示例库不可读或为空（可能建库失败，可重建）。`;
				}
				const embed = await embedder.get();
				const queryVec = embed === undefined ? undefined : (await embed.embed([query]))[0];
				const hits = retrieve(index, query, queryVec, limit, onlyTags);
				if (hits.length === 0) {
					return "无命中。换更具体的场景词或物象词再试（如「茶馆」「对峙」「初见」），或去掉 style_tag 过滤。";
				}
				const lines = [`参考书 ${bookId} · 风格示例 ${hits.length} 段：`];
				for (const [i, hit] of hits.entries()) {
					const keywords =
						hit.entry.keywords.length > 0 ? ` · ${hit.entry.keywords.join("/")}` : "";
					lines.push(
						`[${i + 1}] ${hit.entry.id} · ${hit.entry.styleTag}${keywords} · 第 ${hit.entry.chapterNo} 章`,
						hit.entry.text,
					);
				}
				lines.push("（仅示范段落节奏与叙述腔，禁止复用其内容词句）");
				return lines.join("\n");
			},
		},
	};
}

/** 容错解析参数（形状不符走缺省/报错，不抛 JSON 异常） */
function parseArgs(call: { args: string }): { query: string; style_tag?: string; limit?: number } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(call.args);
	} catch {
		return { query: "" };
	}
	if (parsed === null || typeof parsed !== "object") return { query: "" };
	const obj = parsed as Record<string, unknown>;
	return {
		query: typeof obj.query === "string" ? obj.query : "",
		...(typeof obj.style_tag === "string" ? { style_tag: obj.style_tag } : {}),
		...(typeof obj.limit === "number" && Number.isInteger(obj.limit) ? { limit: obj.limit } : {}),
	};
}

/** 数值夹取 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
