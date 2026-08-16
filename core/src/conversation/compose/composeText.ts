/**
 * compose 系列提醒文案（逐字对齐 legacy-main runtime/nudge/definitions/compose.ts）。
 * nudge 注入与 Enter/ExitComposeMode 工具结果共用本模块渲染函数。
 */
import * as path from "node:path";

const COMPOSE_MODE_EXIT_TEXT = [
	"# 设计模式已结束",
	"正式稿写入已恢复。请按审批结果继续创作：",
	"- 若已批准：按草稿内容将正文写入正式稿（canonical 写入工具已恢复）。",
	"- 若已放弃：草稿文件保留在会话设计目录中，可随时重新进入设计模式。",
].join("\n");

const COMPOSE_MODE_PENDING_TEXT = [
	"# 设计模式：等待审批",
	"草稿已提交审批，等待作者确认。在作者批准或拒绝前，不要继续修改草稿。",
].join("\n");

const COMPOSE_MODE_REENTRY_TEXT = [
	"# 设计模式：已有旧草稿",
	"检测到本会话存在上次的设计草稿。开始创作前：",
	"1. 先读取旧草稿，了解之前规划的内容。",
	"2. 对照当前需求评估：",
	"   - **不同需求**：覆盖旧草稿，从头开始。",
	"   - **延续需求**：在旧草稿基础上增量修改，清理过时部分。",
	"3. 然后按设计模式创作流程继续。",
].join("\n");

const COMPOSE_MODE_SPARSE_TEXT = [
	"# 设计模式（刷新）",
	"设计模式仍激活：正式稿只读、草稿维护在 `.novel/design/`、完成后用 **ExitComposeMode** 提交审批。完整流程见前文。",
].join("\n");

/**
 * 绝对 design 文件路径 → workspace 相对路径（`.novel/design/<id>.md`，正斜杠）
 * @param designFilePath design 文件绝对路径
 * @returns workspace 相对路径
 */
export function designFileWorkspaceRelativePath(designFilePath: string): string {
	return path
		.join(".novel", "design", path.basename(designFilePath))
		.split(path.sep)
		.join("/");
}

/**
 * 进入 compose 时附加的 full 5-phase 创作工作流全文
 * @param designFilePath workspace 相对 design 文件路径（可选，缺省省略该行）
 * @returns 完整文案
 */
export function renderComposeModeFullText(designFilePath?: string): string {
	return [
		"# 设计模式（Compose Mode）",
		"当前处于**设计模式**，以下约束优先于其他任何指令：",
		"- 正式稿只读：canonical 写入工具会被拒绝；文件工具（Read/Glob/Write/Edit）全模式可用，路径一律用 **workspace 相对路径**（越出 workspace 沙盒会报错）。",
		"- 草稿维护在 `.novel/design/` 设计目录。",
		...(designFilePath === undefined ? [] : [`- 当前会话设计文件：\`${designFilePath}\``]),
		"",
		"## 创作工作流",
		"按以下阶段推进创作：",
		"",
		"### Phase 1: 理解需求",
		"聚焦给定的创作需求，阅读相关既有设定（大纲/人物/地点），理解当前故事结构与约束。",
		"",
		"### Phase 2: 探索",
		"建议派 **Explore** 子代理并行查设定、时间线、伏笔、矛盾点；复杂任务必派，琐碎任务可直接用只读工具自行探索。",
		"",
		"### Phase 3: 创作草案",
		"建议派 **Compose** 子代理设计大纲或正文草案；复杂草稿必派，琐碎草稿可自行创作。",
		"",
		"### Phase 4: 综合写入草稿",
		"评审子代理产出，用 Write/Edit 增量完善 design 文件（唯一可写文件）。",
		"",
		"### Phase 5: 提交审批",
		"草稿完成后调用 **ExitComposeMode** 提交审批；不得用文本询问审批；若被拒：按反馈修订后重新提交，不要原样重试。",
	].join("\n");
}

/**
 * ExitComposeMode tool_result 与模板共用的退出回显文案
 * @returns 退出文案
 */
export function renderComposeModeExitText(): string {
	return COMPOSE_MODE_EXIT_TEXT;
}

/**
 * compose_mode_pending 模板与关联回显共用的等待审批文案
 * @returns 等待审批文案
 */
export function renderComposeModePendingText(): string {
	return COMPOSE_MODE_PENDING_TEXT;
}

/**
 * compose_mode_reentry 模板的已有旧草稿决策文案
 * @returns 旧草稿决策文案
 */
export function renderComposeModeReentryText(): string {
	return COMPOSE_MODE_REENTRY_TEXT;
}

/**
 * compose_mode_sparse 模板的瞬态刷新文案
 * @returns 刷新文案
 */
export function renderComposeModeSparseText(): string {
	return COMPOSE_MODE_SPARSE_TEXT;
}
