/**
 * LibraryRead external tool（PRD library-完本解构 F11）：novel 主 Agent 读全局
 * 书库的唯一入口——工具薄壳，只做参数校验 + 转调 LibraryService 领域接口，
 * 不感知存储细节（每书 book.db / paragraphs 文件 / manifest / 书单）。
 * kind 语义与 NovelRead 对齐（实体类经 NovelRead 复用同套校验与查询），
 * 扩展 overview（书目）/ style / excerpt（分析产物）/ paragraph（文件分段）。
 * 访问控制与长度护栏内聚在 LibraryService（未授权不泄漏存在性）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";
import { createNovelEntityTools } from "./novel.js";
import type { NovelStore } from "../../../novel/store.js";
import type {
	BookSummary,
	LibraryService,
} from "../../../library/LibraryService.js";
import { LibraryError } from "../../../library/LibraryService.js";

/** LibraryRead 对服务层的结构依赖（LibraryService 结构满足；测试可注入桩） */
export interface LibraryReadDeps {
	/** 列书（service 内已按工作区书单过滤） */
	listBooks(): Promise<readonly BookSummary[]>;
	/** 打开某书 novel 域 store（service 内已做书单校验） */
	openBookStore(bookId: string, options?: { readOnly?: boolean }): Promise<NovelStore>;
	/** 读分段正文（service 内已做书单校验 + 条数护栏） */
	readParagraphs(
		bookId: string,
		query: {
			ids?: readonly string[];
			chapterNo?: number;
			offset?: number;
			limit?: number;
		},
	): Promise<{
		items: ReadonlyArray<{
			id: string;
			chapterNo: number;
			chapterTitle: string;
			chars: number;
			text: string;
		}>;
		total: number;
	}>;
	/** 读分析产物（service 内已做书单校验 + 长度护栏） */
	readAnalysis(
		bookId: string,
		which: "style" | "excerpt",
		maxChars?: number,
	): Promise<{ content: string; truncated: boolean }>;
}

/** LibraryRead 组装选项 */
export interface LibraryReadToolOptions {
	/** 服务依赖（LibraryService 实例或结构等价桩；缺省=未装配降级——
	 *   execute 返回不可用文本，对齐 runtime.ask 的「未送达」先例） */
	deps?: LibraryReadDeps;
}

/** 全部合法 kind */
const ALL_KINDS = [
	"overview",
	"character",
	"location",
	"story_unit",
	"paragraph",
	"volume",
	"chapter",
	"style",
	"excerpt",
] as const;

/** 实体类 kind 允许透传给 NovelRead 的过滤参数 */
const ENTITY_FILTER_KEYS = [
	"characterId",
	"locationId",
	"storyUnitId",
	"includePlans",
	"volumeId",
	"chapterId",
	"includeContent",
] as const;

/**
 * 创建 LibraryRead 工具（薄壳：校验 + 转调服务；实体 kind 复用 NovelRead 执行体）
 * @param options 服务依赖
 * @returns LibraryRead ToolDef
 */
export function createLibraryReadTool(options: LibraryReadToolOptions): ToolDef {
	/** 实体工具缓存（bookId → NovelRead 执行体；NovelRead 语义零重复实现） */
	const entityReaders = new Map<string, ToolDef>();
	/** id 计数（合成 ToolCall 用） */
	let callSeq = 0;

	/** 取某书的 NovelRead 执行体（经服务开 store，书单校验内聚；未装配即拒） */
	const entityReaderOf = async (bookId: string): Promise<ToolDef> => {
		if (options.deps === undefined) {
			throw new ToolError(
				{ code: "TOOL_ARGUMENTS_INVALID", toolName: "LibraryRead" },
				"书库服务未装配，本会话无法读取书库。",
			);
		}
		const cached = entityReaders.get(bookId);
		if (cached !== undefined) return cached;
		const store = await options.deps.openBookStore(bookId);
		const handle: NovelHandle = {
			query: (q) => store.query(q),
			mutate: (m) => store.mutate(m),
		} as NovelHandle;
		const read = createNovelEntityTools(handle).find((t) => t.name === "NovelRead");
		if (read === undefined) throw new Error("NovelRead 工具缺失（装配异常）");
		entityReaders.set(bookId, read);
		return read;
	};

	return {
		name: "LibraryRead",
		version: "1.0.0",
		description: [
			"读取书库（已完本参考书）资产，只读。kind 必填；除 overview 外必须给 bookId。",
			"",
			"## 数据形态",
			"- 书库是全局的（跨工作区共享）；当前工作区只能访问书单授权的书（未授权/不存在统一报错）。",
			"- 每本书与本项目同构：卷/章（发布骨架）、人物/地点/大纲 story unit（解构产物）在库内；",
			"  正文段落以文件分段存储，经 paragraph kind 按 id 或按章批量读取。",
			"- 概念边界（域模型规范）：大纲（story unit）= 叙事单位（幕级：时间/地点/人物/事件）；卷/章 = 发布单位——两者无结构对应。",
			"",
			"## 用法",
			"- overview：列出当前工作区可访问的书目（bookId/标题/状态/统计/产物就绪位）。先看这里。",
			"- character / location / story_unit / volume / chapter：同 NovelRead 语义的过滤参数 + 顶层 bookId。",
			"- paragraph：paragraphId 精确取一段；或 chapterNo 批量取该章分段（offset/limit 翻页，单次上限 24 段）。",
			"- style：该书全局风格 md（内容风格/技法，结论附 paragraph id 例证）。",
			"- excerpt：该书特色原文摘录（paragraph id + 摘录 + 代表性说明）。",
			"- 一切产物引用正文都用 paragraph id（形如 <bookId>-p000123）；不要整段复制进实体或正文。",
			"",
			"## 实例",
			"<example>",
			"作者：参考书库里那本，它的对话风格有什么特点？",
			"→ LibraryRead(kind=overview)",
			"→ LibraryRead(kind=style, bookId=<书目 id>)",
			"<reasoning>先列书拿 bookId，再读风格 md；引用例证时用其中的 paragraph id。</reasoning>",
			"</example>",
		].join("\n"),
		parameters: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [...ALL_KINDS],
					description:
						"读取类型：overview=可访问书目；character/location/story_unit/volume/chapter=该书实体（同 NovelRead 过滤参数）；paragraph=正文分段；style=全局风格 md；excerpt=特色原文摘录",
				},
				bookId: {
					type: "string",
					description: "书 id（除 overview 外必填；来自 overview 返回的 bookId）",
				},
				characterId: { type: "string", description: "仅 character：角色 id（省略列全部）" },
				locationId: { type: "string", description: "仅 location：地点 id（省略列全部）" },
				storyUnitId: { type: "string", description: "仅 story_unit：单元 id（省略返回全树）" },
				includePlans: {
					type: "boolean",
					description: "仅 story_unit：附带 leaf 计划与叶完成度 rollup",
				},
				volumeId: { type: "string", description: "仅 chapter：按卷过滤" },
				chapterId: { type: "string", description: "仅 chapter：只读该章" },
				includeContent: {
					type: "boolean",
					description: "仅 chapter：附带每章按 paragraphIds 选择取回的正文段落",
				},
				paragraphId: { type: "string", description: "仅 paragraph：精确取该分段" },
				chapterNo: { type: "integer", description: "仅 paragraph：批量取该章全部分段" },
				offset: { type: "integer", description: "仅 paragraph：翻页偏移（缺省 0）" },
				limit: { type: "integer", description: "仅 paragraph：单次条数（缺省 6，上限 24）" },
			},
			required: ["kind"],
			additionalProperties: false,
		},
		promptDetail: {
			policy:
				"书库只读引用：先 overview 拿 bookId 再细读；引用原文一律写 paragraph id，禁止大段复制进本项目实体。",
			guidance: "",
		},
		handler: {
			execute: async (call: ToolCall) => {
				try {
					return await executeLibraryRead(call, options, entityReaderOf, () => `library-${++callSeq}`);
				} catch (err) {
					// 服务层访问类错误 → 参数类工具错误（未授权/不存在不泄漏存在性）
					if (
						err instanceof LibraryError &&
						(err.code === "LIB_BOOK_NOT_AUTHORIZED" ||
							err.code === "LIB_BOOK_NOT_FOUND" ||
							err.code === "LIB_INVALID_ARGUMENT")
					) {
						throw new ToolError({ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name }, err.message);
					}
					throw err;
				}
			},
		},
	};
}

/**
 * LibraryRead 执行体（薄壳逻辑独立函数，便于直测）
 * @param call 工具调用
 * @param options 服务依赖
 * @param entityReaderOf 实体读取器获取器（缓存 NovelRead 执行体）
 * @param nextCallId 合成 ToolCall id 生成器
 * @returns 结果文本（JSON）
 */
async function executeLibraryRead(
	call: ToolCall,
	options: LibraryReadToolOptions,
	entityReaderOf: (bookId: string) => Promise<ToolDef>,
	nextCallId: () => string,
): Promise<string> {
	if (options.deps === undefined) {
		return "书库服务未装配：本会话无法读取书库（LibraryRead 不可用）。";
	}
	const deps = options.deps;
	const args = parseArgs(call);
	const kind = String(args.kind);
	if (!ALL_KINDS.includes(kind as (typeof ALL_KINDS)[number])) {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
			`未知 kind：${kind}（可选 ${ALL_KINDS.join(" / ")}）`,
		);
	}
	if (kind === "overview") {
		const books = await deps.listBooks();
		return JSON.stringify({ count: books.length, books });
	}
	const bookId = args.bookId;
	if (typeof bookId !== "string" || bookId.trim().length === 0) {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
			`kind=${kind} 需要必填参数 bookId`,
		);
	}
	if (kind === "paragraph") {
		const result = await deps.readParagraphs(bookId, {
			...(typeof args.paragraphId === "string" ? { ids: [args.paragraphId] } : {}),
			...(typeof args.chapterNo === "number" ? { chapterNo: args.chapterNo } : {}),
			...(typeof args.offset === "number" ? { offset: args.offset } : {}),
			...(typeof args.limit === "number" ? { limit: args.limit } : {}),
		});
		return JSON.stringify(result);
	}
	if (kind === "style" || kind === "excerpt") {
		const result = await deps.readAnalysis(bookId, kind);
		return JSON.stringify(result);
	}
	// 实体类 kind：复用 NovelRead 执行体（同套 kind 校验与查询语义）
	const reader = await entityReaderOf(bookId);
	const entityArgs: Record<string, unknown> = { kind };
	for (const key of ENTITY_FILTER_KEYS) {
		const value = args[key];
		if (value !== undefined) entityArgs[key] = value;
	}
	return reader.handler.execute({
		id: nextCallId(),
		name: "NovelRead",
		args: JSON.stringify(entityArgs),
	});
}

/**
 * 解析并校验工具参数 JSON
 * @param call 工具调用
 * @returns 已解析参数对象
 */
function parseArgs(call: ToolCall): Record<string, unknown> {
	try {
		return JSON.parse(call.args) as Record<string, unknown>;
	} catch {
		throw new ToolError(
			{ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
			`无效的 JSON 参数: ${call.args}`,
		);
	}
}

/**
 * 便捷工厂：由 LibraryService 实例直接构造 LibraryRead 工具
 * @param service 书库服务
 * @returns LibraryRead ToolDef
 */
export function createLibraryReadToolFromService(service: LibraryService): ToolDef {
	return createLibraryReadTool({ deps: service });
}
