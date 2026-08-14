/**
 * tool preview 纯函数目录（ToolDef.preview 的内置实现 + 默认回退 + 查询器）。
 * **纯性约束**：严禁 import NovelHandle/fs/runtime 状态——Main 进程代读路径必须静态装配，
 * 同一 preview 函数在 live 投影与 journal 重投影下产出逐字节一致（PRD `output-投影层` §4.3）。
 */

/** preview 输入：工具调用参数（JSON 字符串） */
export interface ToolPreviewInput {
	args: string;
}

/** preview 响应输入：工具执行结果（started 无，recorded 有） */
export interface ToolPreviewResponse {
	result?: string;
	error?: string;
}

/** preview 输出：title 标题 / summary 摘要（均可选，UI 按可选字段降级渲染） */
export interface ToolPreviewOutput {
	title?: string;
	summary?: string;
}

/** preview 函数签名（ToolDef.preview）：纯函数，同输入同输出（replay 确定性前提） */
export type ToolPreviewFn = (
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
) => ToolPreviewOutput;

/** preview 查询器：按工具名取 preview 函数（缺省 resolveToolPreview 纯目录） */
export interface ToolPreviewResolver {
	/**
	 * 按工具名解析 preview
	 * @param name 工具名
	 * @returns preview 函数或 undefined（未注册）
	 */
	resolvePreview(name: string): ToolPreviewFn | undefined;
}

/** 默认 args 截断长度（超长仅留前缀 + 省略号） */
const MAX_PREVIEW_ARGS = 120;

/** 截断超长文本（≤120 字符原样；超长前缀 + …） */
function truncate(text: string): string | undefined {
	if (text === undefined || text === "") return undefined;
	return text.length > MAX_PREVIEW_ARGS ? `${text.slice(0, MAX_PREVIEW_ARGS)}…` : text;
}

/** 安全解析 JSON 参数（解析失败返回 undefined） */
function parseArgsJson(args: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(args) as unknown;
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * 默认 preview 回退（未声明 preview 的工具）：
 * started（无 response）→ args 截断摘要；recorded（有 response）→ 摘要 + 完成/失败结果。
 * @param call 工具调用输入
 * @param response 执行响应（可选）
 * @returns 默认预览内容
 */
export function defaultToolPreview(
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	const summary = truncate(call.args);
	if (response === undefined) return summary === undefined ? {} : { summary };
	const outcome = response.error !== undefined ? "执行失败" : "执行完成";
	return { summary: summary !== undefined ? `${summary}（${outcome}）` : outcome };
}

/** CharacterWrite preview：解析 values[].name 列表 → 角色名标题（示例接线） */
export function characterWritePreview(
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = parsed?.values;
	const names = Array.isArray(values)
		? values
				.map((v) => (typeof v === "object" && v !== null ? (v as { name?: unknown }).name : undefined))
				.filter((n): n is string => typeof n === "string" && n.length > 0)
		: [];
	const title = names.length > 0 ? `角色：${names.join("、")}` : "角色";
	if (response === undefined) return { title };
	return {
		title,
		summary: response.error !== undefined ? "角色写入失败" : "角色已写入",
	};
}

/** ParagraphWrite preview：解析 storyUnitId → 章节标题 + 正文开头摘要（示例接线） */
export function paragraphWritePreview(
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const storyUnitId = typeof parsed?.storyUnitId === "string" ? parsed.storyUnitId : undefined;
	const text = typeof parsed?.text === "string" ? truncate(parsed.text) : undefined;
	const title = storyUnitId !== undefined && storyUnitId.length > 0 ? `正文：${storyUnitId}` : "正文";
	if (response === undefined) return { title, ...(text !== undefined ? { summary: text } : {}) };
	return {
		title,
		summary: response.error !== undefined ? "正文插入失败" : "正文已插入",
	};
}

/** 内置 preview 目录（工具名 → preview 函数） */
export const TOOL_PREVIEWS: ReadonlyMap<string, ToolPreviewFn> = new Map<string, ToolPreviewFn>([
	["CharacterWrite", characterWritePreview],
	["ParagraphWrite", paragraphWritePreview],
]);

/**
 * 按工具名解析 preview（纯目录；未注册返回 undefined → 上层走 defaultToolPreview）。
 * @param name 工具名
 * @returns preview 函数或 undefined
 */
export function resolveToolPreview(name: string): ToolPreviewFn | undefined {
	return TOOL_PREVIEWS.get(name);
}
