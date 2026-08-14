/**
 * tool preview 纯函数目录（ToolDef.preview 的内置实现 + 默认回退 + 查询器）。
 * **纯性约束**：严禁 import NovelHandle/fs/runtime 状态——Main 进程代读路径必须静态装配，
 * 同一 preview 函数在 live 投影与 journal 重投影下产出逐字节一致（PRD `output-投影层` §4.3）。
 * 语义约定：started（无 response）给出「意图」标题/摘要；recorded（有 response）给出「结果」摘要。
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

/** 路径末段（file_path → basename；支持 / 与 \\） */
function basenameOf(path: string): string {
	const segments = path.split(/[/\\]/).filter((s) => s.length > 0);
	return segments.at(-1) ?? path;
}

/** 列表值取字段拼「、」（空返回 undefined；整体截断） */
function joinList(values: unknown[], pick: (v: Record<string, unknown>) => string | undefined): string | undefined {
	const labels = values
		.map((v) => (typeof v === "object" && v !== null ? pick(v as Record<string, unknown>) : undefined))
		.filter((s): s is string => typeof s === "string" && s.length > 0);
	if (labels.length === 0) return undefined;
	return truncate(labels.join("、"));
}

/** 响应结果短语（error → 失败动词；成功 → 成功动词） */
function outcomePhrase(response: ToolPreviewResponse | undefined, verbDone: string, verbFailed: string): string {
	if (response === undefined) return verbDone;
	return response.error !== undefined ? verbFailed : verbDone;
}

/** 单实体预览（Read/Edit 通用）：title + recorded 结果短语 */
function entityPreview(
	title: string,
	verbDone: string,
	verbFailed: string,
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	if (response === undefined) return { title };
	return { title, summary: outcomePhrase(response, verbDone, verbFailed) };
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

/* ============ character 域 ============ */

/** CharacterRead preview：单读 → 「角色：<id>」；列表 → 「角色列表」 */
export function characterReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const id = parseArgsJson(call.args)?.characterId;
	const title = typeof id === "string" && id.length > 0 ? `角色：${id}` : "角色列表";
	return entityPreview(title, "已读取", "读取失败", call, response);
}

/** CharacterWrite preview：解析 values[].name 列表 → 角色名标题 */
export function characterWritePreview(
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => (typeof v.name === "string" ? v.name : undefined))
		: undefined;
	const title = names !== undefined ? `角色：${names}` : "角色";
	if (response === undefined) return { title };
	return { title, summary: outcomePhrase(response, "角色已写入", "角色写入失败") };
}

/** CharacterEdit preview：解析 values[] 的 patch.name/characterId → 标题 */
export function characterEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const patch = typeof v.patch === "object" && v.patch !== null ? (v.patch as Record<string, unknown>) : {};
		const name = typeof patch.name === "string" && patch.name.length > 0 ? patch.name : undefined;
		const id = typeof v.characterId === "string" ? v.characterId : undefined;
		return name ?? id;
	});
	return entityPreview(names !== undefined ? `角色：${names}` : "角色", "角色已更新", "角色更新失败", call, response);
}

/* ============ location 域 ============ */

/** LocationRead preview：单读 → 「地点：<id>」；列表 → 「地点列表」 */
export function locationReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const id = parseArgsJson(call.args)?.locationId;
	const title = typeof id === "string" && id.length > 0 ? `地点：${id}` : "地点列表";
	return entityPreview(title, "已读取", "读取失败", call, response);
}

/** LocationWrite preview：解析 values[].name 列表 → 地点名标题 */
export function locationWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => (typeof v.name === "string" ? v.name : undefined))
		: undefined;
	const title = names !== undefined ? `地点：${names}` : "地点";
	if (response === undefined) return { title };
	return { title, summary: outcomePhrase(response, "地点已写入", "地点写入失败") };
}

/** LocationEdit preview：解析 values[] 的 patch.name/locationId → 标题 */
export function locationEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const patch = typeof v.patch === "object" && v.patch !== null ? (v.patch as Record<string, unknown>) : {};
		const name = typeof patch.name === "string" && patch.name.length > 0 ? patch.name : undefined;
		const id = typeof v.locationId === "string" ? v.locationId : undefined;
		return name ?? id;
	});
	return entityPreview(names !== undefined ? `地点：${names}` : "地点", "地点已更新", "地点更新失败", call, response);
}

/* ============ paragraph 域 ============ */

/** ParagraphRead preview：按 paragraphId/storyUnitId 给出目标标题 */
export function paragraphReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const target =
		typeof parsed?.paragraphId === "string" && parsed.paragraphId.length > 0
			? parsed.paragraphId
			: typeof parsed?.storyUnitId === "string" && parsed.storyUnitId.length > 0
			  ? parsed.storyUnitId
			  : undefined;
	return entityPreview(target !== undefined ? `正文：${target}` : "正文", "已读取", "读取失败", call, response);
}

/** ParagraphWrite preview：解析 storyUnitId → 章节标题 + 正文开头摘要 */
export function paragraphWritePreview(
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const storyUnitId = typeof parsed?.storyUnitId === "string" ? parsed.storyUnitId : undefined;
	const text = typeof parsed?.text === "string" ? truncate(parsed.text) : undefined;
	const title = storyUnitId !== undefined && storyUnitId.length > 0 ? `正文：${storyUnitId}` : "正文";
	if (response === undefined) return { title, ...(text !== undefined ? { summary: text } : {}) };
	return { title, summary: outcomePhrase(response, "正文已插入", "正文插入失败") };
}

/** ParagraphEdit preview：段落替换 → 「正文：<paragraphId>」+ 新文本摘要 */
export function paragraphEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const id = typeof parsed?.paragraphId === "string" ? parsed.paragraphId : undefined;
	const text = typeof parsed?.text === "string" ? truncate(parsed.text) : undefined;
	const title = id !== undefined && id.length > 0 ? `正文：${id}` : "正文";
	if (response === undefined) return { title, ...(text !== undefined ? { summary: text } : {}) };
	return { title, summary: outcomePhrase(response, "正文已更新", "正文更新失败") };
}

/* ============ publication 域 ============ */

/** PublicationRead preview：发布结构读取 */
export function publicationReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	return entityPreview("发布结构", "已读取", "读取失败", call, response);
}

/** PublicationWrite preview：创建卷/章 → 「发布：<卷/章>「<title>」」 */
export function publicationWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const kind = parsed?.kind === "chapter" ? "章" : "卷";
	const title = typeof parsed?.title === "string" && parsed.title.length > 0 ? parsed.title : undefined;
	const heading = title !== undefined ? `发布：${kind}「${title}」` : `发布：${kind}`;
	if (response === undefined) return { title: heading };
	return { title: heading, summary: outcomePhrase(response, "已创建", "创建失败") };
}

/** PublicationEdit preview：更新卷/章 → 「发布：<patch.title 或 id>」 */
export function publicationEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const patch = typeof parsed?.patch === "object" && parsed.patch !== null ? (parsed.patch as Record<string, unknown>) : {};
	const patchTitle = typeof patch.title === "string" && patch.title.length > 0 ? patch.title : undefined;
	const id =
		typeof parsed?.chapterId === "string" && parsed.chapterId.length > 0
			? parsed.chapterId
			: typeof parsed?.volumeId === "string" && parsed.volumeId.length > 0
			  ? parsed.volumeId
			  : undefined;
	return entityPreview(`发布：${patchTitle ?? id ?? (parsed?.kind === "chapter" ? "章" : "卷")}`, "已更新", "更新失败", call, response);
}

/** 删除 kind → 领域标签 */
function deleteKindLabel(kind: string): string {
	switch (kind) {
		case "story_unit":
			return "大纲单元";
		case "character":
			return "角色";
		case "location":
			return "地点";
		case "paragraph":
			return "段落";
		case "volume":
			return "卷";
		case "chapter":
			return "章";
		default:
			return kind;
	}
}

/** NovelDelete preview：删除目标聚合（kind 标签 × 数量） */
export function novelDeletePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const labels = values.map((v) =>
		typeof v === "object" && v !== null ? deleteKindLabel(String((v as Record<string, unknown>).kind ?? "")) : "实体",
	);
	const title = labels.length > 0 ? `删除：${truncate(labels.join("、"))}（${labels.length} 项）` : "删除";
	if (response === undefined) return { title };
	return { title, summary: outcomePhrase(response, "已删除", "删除失败") };
}

/* ============ outline 域 ============ */

/** OutlineRead preview：单读 → 「大纲：<storyUnitId>」；全树 → 「大纲」 */
export function outlineReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const id = parseArgsJson(call.args)?.storyUnitId;
	const title = typeof id === "string" && id.length > 0 ? `大纲：${id}` : "大纲";
	return entityPreview(title, "已读取", "读取失败", call, response);
}

/** OutlineWrite preview：创建 story unit → 「大纲：<title>」 */
export function outlineWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const title = typeof parsed?.title === "string" && parsed.title.length > 0 ? parsed.title : undefined;
	const heading = title !== undefined ? `大纲：${title}` : "大纲";
	if (response === undefined) return { title: heading };
	return { title: heading, summary: outcomePhrase(response, "已创建", "创建失败") };
}

/** OutlineEdit preview：更新 story unit → 「大纲：<patch.title 或 storyUnitId>」 */
export function outlineEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const patch = typeof parsed?.patch === "object" && parsed.patch !== null ? (parsed.patch as Record<string, unknown>) : {};
	const patchTitle = typeof patch.title === "string" && patch.title.length > 0 ? patch.title : undefined;
	const id = typeof parsed?.storyUnitId === "string" ? parsed.storyUnitId : undefined;
	return entityPreview(`大纲：${patchTitle ?? id ?? "单元"}`, "已更新", "更新失败", call, response);
}

/* ============ files 域 ============ */

/** Read preview：文件读取 → 「读取：<basename>」 */
export function fileReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const path = typeof parsed?.file_path === "string" ? parsed.file_path : undefined;
	const title = path !== undefined && path.length > 0 ? `读取：${basenameOf(path)}` : "读取文件";
	return entityPreview(title, "已读取", "读取失败", call, response);
}

/** Glob preview：模式查找 → 「查找：<pattern>」 */
export function fileGlobPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const pattern = typeof parsed?.pattern === "string" && parsed.pattern.length > 0 ? parsed.pattern : undefined;
	const title = pattern !== undefined ? `查找：${truncate(pattern)}` : "查找文件";
	return entityPreview(title, "已查找", "查找失败", call, response);
}

/** Write preview：文件写入 → 「写入：<basename>」+ 内容开头摘要 */
export function fileWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const path = typeof parsed?.file_path === "string" ? parsed.file_path : undefined;
	const content = typeof parsed?.content === "string" ? truncate(parsed.content) : undefined;
	const title = path !== undefined && path.length > 0 ? `写入：${basenameOf(path)}` : "写入文件";
	if (response === undefined) return { title, ...(content !== undefined ? { summary: content } : {}) };
	return { title, summary: outcomePhrase(response, "已写入", "写入失败") };
}

/** Edit preview：文件编辑 → 「编辑：<basename>」+ old_string 摘要 */
export function fileEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const path = typeof parsed?.file_path === "string" ? parsed.file_path : undefined;
	const oldText = typeof parsed?.old_string === "string" ? truncate(parsed.old_string) : undefined;
	const title = path !== undefined && path.length > 0 ? `编辑：${basenameOf(path)}` : "编辑文件";
	if (response === undefined) return { title, ...(oldText !== undefined ? { summary: oldText } : {}) };
	return { title, summary: outcomePhrase(response, "已替换", "替换失败") };
}

/* ============ todo 域 ============ */

/** TodoWrite preview：待办替换 → 「待办：<count> 项」+ 进行中项摘要 */
export function todoWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const todos = Array.isArray(parsed?.todos) ? (parsed.todos as unknown[]) : [];
	const title = `待办：${todos.length} 项`;
	if (response === undefined) {
		const inProgress = todos
			.map((t) =>
				typeof t === "object" && t !== null ? (t as Record<string, unknown>) : {},
			)
			.find((t) => t.status === "in_progress");
		const first = todos.length > 0 ? (todos[0] as Record<string, unknown>) : undefined;
		const label = (inProgress?.activeForm ?? inProgress?.content ?? first?.content) as string | undefined;
		return { title, ...(typeof label === "string" && label.length > 0 ? { summary: truncate(label) } : {}) };
	}
	return { title, summary: outcomePhrase(response, "已更新", "更新失败") };
}

/** 内置 preview 目录（工具名 → preview 函数；全部现有工具已注册） */
export const TOOL_PREVIEWS: ReadonlyMap<string, ToolPreviewFn> = new Map<string, ToolPreviewFn>([
	["CharacterRead", characterReadPreview],
	["CharacterWrite", characterWritePreview],
	["CharacterEdit", characterEditPreview],
	["LocationRead", locationReadPreview],
	["LocationWrite", locationWritePreview],
	["LocationEdit", locationEditPreview],
	["ParagraphRead", paragraphReadPreview],
	["ParagraphWrite", paragraphWritePreview],
	["ParagraphEdit", paragraphEditPreview],
	["PublicationRead", publicationReadPreview],
	["PublicationWrite", publicationWritePreview],
	["PublicationEdit", publicationEditPreview],
	["NovelDelete", novelDeletePreview],
	["OutlineRead", outlineReadPreview],
	["OutlineWrite", outlineWritePreview],
	["OutlineEdit", outlineEditPreview],
	["Read", fileReadPreview],
	["Glob", fileGlobPreview],
	["Write", fileWritePreview],
	["Edit", fileEditPreview],
	["TodoWrite", todoWritePreview],
]);

/**
 * 按工具名解析 preview（纯目录；未注册返回 undefined → 上层走 defaultToolPreview）。
 * @param name 工具名
 * @returns preview 函数或 undefined
 */
export function resolveToolPreview(name: string): ToolPreviewFn | undefined {
	return TOOL_PREVIEWS.get(name);
}
