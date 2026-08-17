/**
 * tool preview 纯函数目录（ToolDef.preview 的内置实现 + 默认回退 + 查询器）。
 * **纯性约束**：严禁 import NovelHandle/fs/runtime 状态——Main 进程代读路径必须静态装配，
 * 同一 preview 函数在 live 投影与 journal 重投影下产出逐字节一致（PRD `output-投影层` §4.3）。
 *
 * 语义约定（配合 UI 的 turn 工具行，见 docs/design/tool-call-embed-demo.html）：
 * - `action` + `object`：动作标识（编辑/角色 → 进行中「编辑角色中」、完成「角色编辑已完成」）；
 * - `title`：纯内容（张三 / ch3 / 设定.md），工具行与卡片共用；
 * - `summary`：结果短语（卡片摘要 / 详情 tooltip 用）。
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

/** preview 输出：动作标识 + 内容 + 摘要（均可选，UI 按可选字段降级渲染） */
export interface ToolPreviewOutput {
	/** 动作词（编辑/创建/插入/读取…；与 object 组合成「动作+对象」标识） */
	action?: string;
	/** 对象词（角色/正文/文件…） */
	object?: string;
	/** 内容（张三 / ch3 / 设定.md；无内容场景缺省） */
	title?: string;
	/** 结果摘要（卡片摘要 / 详情 tooltip） */
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

/** 响应结果短语（error → 失败动词；成功 → 成功动词；started 无摘要语义） */
function outcomePhrase(response: ToolPreviewResponse | undefined, verbDone: string, verbFailed: string): string | undefined {
	if (response === undefined) return undefined;
	return response.error !== undefined ? verbFailed : verbDone;
}

/** 组装动作标识输出（started 无 summary；recorded 带结果短语） */
function withIdentity(
	action: string,
	object: string,
	title: string | undefined,
	verbDone: string,
	verbFailed: string,
	response?: ToolPreviewResponse,
): ToolPreviewOutput {
	return {
		action,
		object,
		...(title !== undefined ? { title } : {}),
		...(outcomePhrase(response, verbDone, verbFailed) !== undefined
			? { summary: outcomePhrase(response, verbDone, verbFailed) }
			: {}),
	};
}

/**
 * 默认 preview 回退（未声明 preview 的工具）：
 * action=执行、object=工具名、title=args 截断；recorded 给完成/失败短语。
 * @param call 工具调用输入
 * @param response 执行响应（可选）
 * @param name 工具名（object 兜底；未注册工具经 ProjectionLayer 传入）
 * @returns 默认预览内容
 */
export function defaultToolPreview(
	call: ToolPreviewInput,
	response?: ToolPreviewResponse,
	name?: string,
): ToolPreviewOutput {
	const title = truncate(call.args);
	return withIdentity("执行", name ?? "工具", title, "执行完成", "执行失败", response);
}

/* ============ character 域 ============ */

/** CharacterRead preview：单读 → title=id；列表无 title */
export function characterReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const id = parseArgsJson(call.args)?.characterId;
	const title = typeof id === "string" && id.length > 0 ? id : undefined;
	return withIdentity("读取", "角色", title, "已读取", "读取失败", response);
}

/** CharacterWrite preview：解析 values[].name 列表 → title */
export function characterWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => (typeof v.name === "string" ? v.name : undefined))
		: undefined;
	return withIdentity("创建", "角色", names, "角色已写入", "角色写入失败", response);
}

/** CharacterEdit preview：value.name 优先于 id（P1 形状 values[{id, baseRevision, value}]） */
export function characterEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const rec = (v ?? {}) as Record<string, unknown>;
		const value = typeof rec.value === "object" && rec.value !== null ? (rec.value as Record<string, unknown>) : {};
		const name = typeof value.name === "string" && value.name.length > 0 ? value.name : undefined;
		const id = typeof rec.id === "string" ? rec.id : undefined;
		return name ?? id;
	});
	return withIdentity("编辑", "角色", names, "角色已更新", "角色更新失败", response);
}

/* ============ location 域 ============ */

/** LocationRead preview：单读 → title=id */
export function locationReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const id = parseArgsJson(call.args)?.locationId;
	const title = typeof id === "string" && id.length > 0 ? id : undefined;
	return withIdentity("读取", "地点", title, "已读取", "读取失败", response);
}

/** LocationWrite preview：解析 values[].name 列表 → title */
export function locationWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => (typeof v.name === "string" ? v.name : undefined))
		: undefined;
	return withIdentity("创建", "地点", names, "地点已写入", "地点写入失败", response);
}

/** LocationEdit preview：value.name 优先于 id（P1 形状 values[{id, baseRevision, value}]） */
export function locationEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const rec = (v ?? {}) as Record<string, unknown>;
		const value = typeof rec.value === "object" && rec.value !== null ? (rec.value as Record<string, unknown>) : {};
		const name = typeof value.name === "string" && value.name.length > 0 ? value.name : undefined;
		const id = typeof rec.id === "string" ? rec.id : undefined;
		return name ?? id;
	});
	return withIdentity("编辑", "地点", names, "地点已更新", "地点更新失败", response);
}

/* ============ paragraph 域 ============ */

/** ParagraphRead preview：按 paragraphId/storyUnitId 给出内容 */
export function paragraphReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const target =
		typeof parsed?.paragraphId === "string" && parsed.paragraphId.length > 0
			? parsed.paragraphId
			: typeof parsed?.storyUnitId === "string" && parsed.storyUnitId.length > 0
			  ? parsed.storyUnitId
			  : undefined;
	return withIdentity("读取", "正文", target, "已读取", "读取失败", response);
}

/** ParagraphWrite preview：批量插入 → 首项 storyUnitId + 段数（started detail 用首段文本摘要） */
export function paragraphWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as Record<string, unknown>[]) : [];
	const storyUnitId = values.length > 0 && typeof values[0]!.storyUnitId === "string" && values[0]!.storyUnitId.length > 0 ? (values[0]!.storyUnitId as string) : undefined;
	const text = values.length > 0 && typeof values[0]!.text === "string" ? truncate(values[0]!.text as string) : undefined;
	const count = values.length > 1 ? `（${values.length} 段）` : "";
	return {
		action: "插入",
		object: "正文",
		...(storyUnitId !== undefined ? { title: `${storyUnitId}${count}` } : {}),
		...(response === undefined
			? text !== undefined
				? { summary: text }
				: {}
			: { summary: response.error !== undefined ? "正文插入失败" : "正文已插入" }),
	};
}

/** ParagraphEdit preview：批量替换 → 首项 id + 新文本摘要（P1 形状 values[{id, baseRevision, value}]） */
export function paragraphEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as Record<string, unknown>[]) : [];
	const first = values[0] ?? {};
	const id = typeof first.id === "string" && first.id.length > 0 ? first.id : undefined;
	const value = typeof first.value === "object" && first.value !== null ? (first.value as Record<string, unknown>) : {};
	const text = typeof value.text === "string" ? truncate(value.text) : undefined;
	return {
		action: "编辑",
		object: "正文",
		...(id !== undefined ? { title: id } : {}),
		...(response === undefined
			? text !== undefined
				? { summary: text }
				: {}
			: { summary: response.error !== undefined ? "正文更新失败" : "正文已更新" }),
	};
}

/* ============ volume / chapter 域（发布结构拆分六件套） ============ */

/** VolumeRead preview：卷列表读取 */
export function volumeReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	return withIdentity("读取", "卷", undefined, "已读取", "读取失败", response);
}

/** ChapterRead preview：章读取（chapterId/volumeId 过滤时给出目标） */
export function chapterReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const target =
		typeof parsed?.chapterId === "string" && parsed.chapterId.length > 0
			? parsed.chapterId
			: typeof parsed?.volumeId === "string" && parsed.volumeId.length > 0
				? parsed.volumeId
				: undefined;
	return withIdentity("读取", "章", target, "已读取", "读取失败", response);
}

/** VolumeWrite preview：批量创建卷 → values[].title 列表 */
export function volumeWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => (typeof (v as Record<string, unknown>)?.title === "string" ? ((v as Record<string, unknown>).title as string) : undefined))
		: undefined;
	return withIdentity("创建", "卷", names, "已创建", "创建失败", response);
}

/** ChapterWrite preview：批量创建章 → values[].title 列表 */
export function chapterWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => (typeof (v as Record<string, unknown>)?.title === "string" ? ((v as Record<string, unknown>).title as string) : undefined))
		: undefined;
	return withIdentity("创建", "章", names, "已创建", "创建失败", response);
}

/** VolumeEdit preview：value.title 优先，其次 id（P1 形状 values[{id, baseRevision, value}]） */
export function volumeEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const rec = (v ?? {}) as Record<string, unknown>;
		const value = typeof rec.value === "object" && rec.value !== null ? (rec.value as Record<string, unknown>) : {};
		const title = typeof value.title === "string" && value.title.length > 0 ? value.title : undefined;
		const id = typeof rec.id === "string" ? rec.id : undefined;
		return title ?? id;
	});
	return withIdentity("编辑", "卷", names, "已更新", "更新失败", response);
}

/** ChapterEdit preview：value.title 优先，其次 id（P1 形状 values[{id, baseRevision, value}]） */
export function chapterEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const rec = (v ?? {}) as Record<string, unknown>;
		const value = typeof rec.value === "object" && rec.value !== null ? (rec.value as Record<string, unknown>) : {};
		const title = typeof value.title === "string" && value.title.length > 0 ? value.title : undefined;
		const id = typeof rec.id === "string" ? rec.id : undefined;
		return title ?? id;
	});
	return withIdentity("编辑", "章", names, "已更新", "更新失败", response);
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
	const title = labels.length > 0 ? `${truncate(labels.join("、"))}（${labels.length} 项）` : undefined;
	return withIdentity("删除", "实体", title, "已删除", "删除失败", response);
}

/* ============ outline 域 ============ */

/** OutlineRead preview：单读 → storyUnitId */
export function outlineReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const id = parseArgsJson(call.args)?.storyUnitId;
	const title = typeof id === "string" && id.length > 0 ? id : undefined;
	return withIdentity("读取", "大纲", title, "已读取", "读取失败", response);
}

/** OutlineWrite preview：批量创建 story unit → values[].title 列表 */
export function outlineWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const names = Array.isArray(parsed?.values)
		? joinList(parsed.values as unknown[], (v) => {
				const title = (v as Record<string, unknown> | null)?.title;
				return typeof title === "string" && title.length > 0 ? title : undefined;
			})
		: undefined;
	return withIdentity("创建", "大纲", names, "已创建", "创建失败", response);
}

/** OutlineEdit preview：value.title 优先于 id（P1 形状 values[{id, baseRevision, value}]） */
export function outlineEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const values = Array.isArray(parsed?.values) ? (parsed.values as unknown[]) : [];
	const names = joinList(values, (v) => {
		const rec = (v ?? {}) as Record<string, unknown>;
		const value = typeof rec.value === "object" && rec.value !== null ? (rec.value as Record<string, unknown>) : {};
		const title = typeof value.title === "string" && value.title.length > 0 ? value.title : undefined;
		const id = typeof rec.id === "string" ? rec.id : undefined;
		return title ?? id;
	});
	return withIdentity("编辑", "大纲", names, "已更新", "更新失败", response);
}

/* ============ novel 通用工具（NovelRead / NovelWrite / NovelEdit，按 kind 分派） ============ */

/** NovelRead preview：按 kind 分派到对应域渲染（overview 无目标 id） */
export function novelReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const kind = parseArgsJson(call.args)?.kind;
	switch (typeof kind === "string" ? kind : "") {
		case "character":
			return characterReadPreview(call, response);
		case "location":
			return locationReadPreview(call, response);
		case "story_unit":
			return outlineReadPreview(call, response);
		case "paragraph":
			return paragraphReadPreview(call, response);
		case "volume":
			return volumeReadPreview(call, response);
		case "chapter":
			return chapterReadPreview(call, response);
		case "overview":
			return withIdentity("读取", "总览", undefined, "已读取", "读取失败", response);
		default:
			return withIdentity("读取", "小说", undefined, "已读取", "读取失败", response);
	}
}

/** NovelWrite preview：按 kind 分派到对应域渲染 */
export function novelWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const kind = parseArgsJson(call.args)?.kind;
	switch (typeof kind === "string" ? kind : "") {
		case "character":
			return characterWritePreview(call, response);
		case "location":
			return locationWritePreview(call, response);
		case "story_unit":
			return outlineWritePreview(call, response);
		case "paragraph":
			return paragraphWritePreview(call, response);
		case "volume":
			return volumeWritePreview(call, response);
		case "chapter":
			return chapterWritePreview(call, response);
		default:
			return withIdentity("创建", "实体", undefined, "已创建", "创建失败", response);
	}
}

/** NovelEdit preview：按 kind 分派到对应域渲染 */
export function novelEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const kind = parseArgsJson(call.args)?.kind;
	switch (typeof kind === "string" ? kind : "") {
		case "character":
			return characterEditPreview(call, response);
		case "location":
			return locationEditPreview(call, response);
		case "story_unit":
			return outlineEditPreview(call, response);
		case "paragraph":
			return paragraphEditPreview(call, response);
		case "volume":
			return volumeEditPreview(call, response);
		case "chapter":
			return chapterEditPreview(call, response);
		default:
			return withIdentity("编辑", "实体", undefined, "已更新", "更新失败", response);
	}
}

/* ============ files 域 ============ */

/** Read preview：文件读取 → basename */
export function fileReadPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const path = typeof parsed?.file_path === "string" && parsed.file_path.length > 0 ? parsed.file_path : undefined;
	return withIdentity("读取", "文件", path !== undefined ? basenameOf(path) : undefined, "已读取", "读取失败", response);
}

/** Glob preview：模式查找 → pattern */
export function fileGlobPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const pattern = typeof parsed?.pattern === "string" && parsed.pattern.length > 0 ? truncate(parsed.pattern) : undefined;
	return withIdentity("查找", "文件", pattern, "已查找", "查找失败", response);
}

/** Write preview：文件写入 → basename + 内容开头摘要 */
export function fileWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const path = typeof parsed?.file_path === "string" && parsed.file_path.length > 0 ? parsed.file_path : undefined;
	const content = typeof parsed?.content === "string" ? truncate(parsed.content) : undefined;
	return {
		action: "写入",
		object: "文件",
		...(path !== undefined ? { title: basenameOf(path) } : {}),
		...(response === undefined
			? content !== undefined
				? { summary: content }
				: {}
			: { summary: response.error !== undefined ? "写入失败" : "已写入" }),
	};
}

/** Edit preview：文件编辑 → basename + old_string 摘要 */
export function fileEditPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const path = typeof parsed?.file_path === "string" && parsed.file_path.length > 0 ? parsed.file_path : undefined;
	const oldText = typeof parsed?.old_string === "string" ? truncate(parsed.old_string) : undefined;
	return {
		action: "编辑",
		object: "文件",
		...(path !== undefined ? { title: basenameOf(path) } : {}),
		...(response === undefined
			? oldText !== undefined
				? { summary: oldText }
				: {}
			: { summary: response.error !== undefined ? "替换失败" : "已替换" }),
	};
}

/* ============ todo 域 ============ */

/** TodoWrite preview：待办替换 → N 项 + 进行中项摘要 */
export function todoWritePreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const todos = Array.isArray(parsed?.todos) ? (parsed.todos as unknown[]) : [];
	const title = `${todos.length} 项`;
	if (response === undefined) {
		const inProgress = todos
			.map((t) => (typeof t === "object" && t !== null ? (t as Record<string, unknown>) : {}))
			.find((t) => t.status === "in_progress");
		const first = todos.length > 0 ? (todos[0] as Record<string, unknown>) : undefined;
		const label = (inProgress?.activeForm ?? inProgress?.content ?? first?.content) as string | undefined;
		return {
			action: "更新",
			object: "待办",
			title,
			...(typeof label === "string" && label.length > 0 ? { summary: truncate(label) } : {}),
		};
	}
	return withIdentity("更新", "待办", title, "已更新", "更新失败", response);
}

/* ============ ask 域 ============ */

/** AskUserQuestion preview：向作者提问 → N 问 + 首问 header 摘要 */
export function askUserPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const questions = Array.isArray(parsed?.questions) ? (parsed.questions as unknown[]) : [];
	const title = `${questions.length} 问`;
	if (response === undefined) {
		const first =
			typeof questions[0] === "object" && questions[0] !== null
				? (questions[0] as Record<string, unknown>)
				: {};
		const header = typeof first.header === "string" && first.header.length > 0 ? first.header : undefined;
		return {
			action: "提问",
			object: "作者",
			title,
			...(header !== undefined ? { summary: `等待作答 · ${header}` } : { summary: "等待作答" }),
		};
	}
	return withIdentity("提问", "作者", title, "已作答", "未获回答", response);
}

/* ============ subagent 域（Agent / TaskOutput / TaskStop） ============ */

/** Agent preview：子任务执行 → title=agentType + prompt 摘要 */
export function agentTaskPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const agentType = typeof parsed?.agentType === "string" && parsed.agentType.length > 0 ? parsed.agentType : undefined;
	const prompt = typeof parsed?.prompt === "string" ? truncate(parsed.prompt) : undefined;
	return {
		action: "执行",
		object: "子任务",
		...(agentType !== undefined ? { title: agentType } : {}),
		...(response === undefined
			? prompt !== undefined
				? { summary: prompt }
				: {}
			: { summary: response.error !== undefined ? "子任务执行失败" : "子任务执行完成" }),
	};
}

/** TaskOutput preview：任务输出读取 → taskIds */
export function taskOutputPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const ids = Array.isArray(parsed?.taskIds)
		? (parsed.taskIds as unknown[])
				.map((v) => (typeof v === "string" ? v : undefined))
				.filter((s): s is string => s !== undefined)
		: [];
	const title = ids.length > 0 ? truncate(ids.join("、")) : undefined;
	return withIdentity("读取", "任务输出", title, "已读取", "读取失败", response);
}

/** TaskStop preview：子任务停止 → taskId */
export function taskStopPreview(call: ToolPreviewInput, response?: ToolPreviewResponse): ToolPreviewOutput {
	const parsed = parseArgsJson(call.args);
	const taskId = typeof parsed?.taskId === "string" && parsed.taskId.length > 0 ? parsed.taskId : undefined;
	return withIdentity("停止", "子任务", taskId, "已停止", "停止失败", response);
}

/** 内置 preview 目录（工具名 → preview 函数；当前工具面全量注册） */
export const TOOL_PREVIEWS: ReadonlyMap<string, ToolPreviewFn> = new Map<string, ToolPreviewFn>([
	["NovelRead", novelReadPreview],
	["NovelWrite", novelWritePreview],
	["NovelEdit", novelEditPreview],
	["NovelDelete", novelDeletePreview],
	// 旧六域三件套名（live 工具面已收敛为上方 4 件；保留注册供历史 journal 重投影兼容）
	["NovelCharacterRead", characterReadPreview],
	["NovelCharacterWrite", characterWritePreview],
	["NovelCharacterEdit", characterEditPreview],
	["NovelLocationRead", locationReadPreview],
	["NovelLocationWrite", locationWritePreview],
	["NovelLocationEdit", locationEditPreview],
	["NovelParagraphRead", paragraphReadPreview],
	["NovelParagraphWrite", paragraphWritePreview],
	["NovelParagraphEdit", paragraphEditPreview],
	["NovelVolumeRead", volumeReadPreview],
	["NovelVolumeWrite", volumeWritePreview],
	["NovelVolumeEdit", volumeEditPreview],
	["NovelChapterRead", chapterReadPreview],
	["NovelChapterWrite", chapterWritePreview],
	["NovelChapterEdit", chapterEditPreview],
	["NovelOutlineRead", outlineReadPreview],
	["NovelOutlineWrite", outlineWritePreview],
	["NovelOutlineEdit", outlineEditPreview],
	["Read", fileReadPreview],
	["Glob", fileGlobPreview],
	["Write", fileWritePreview],
	["Edit", fileEditPreview],
	["TodoWrite", todoWritePreview],
	["AskUserQuestion", askUserPreview],
	["Agent", agentTaskPreview],
	["TaskOutput", taskOutputPreview],
	["TaskStop", taskStopPreview],
]);

/**
 * 按工具名解析 preview（纯目录；未注册返回 undefined → 上层走 defaultToolPreview）。
 * @param name 工具名
 * @returns preview 函数或 undefined
 */
export function resolveToolPreview(name: string): ToolPreviewFn | undefined {
	return TOOL_PREVIEWS.get(name);
}
