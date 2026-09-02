/**
 * NovelImportText：项目导入解构会话专用——把导入书稿的**原文段落区间**确定性
 * 落库到指定大纲单元（ProjectImporter 专用组 novel.import，不进主 agent）。
 *
 * 设计约束（PRD project-import v0.3 F5「段落随场景导入」）：
 * - 参数面只有 unitId + 段落区间号——**不含任何文本字段**；正文由宿主从批次
 *   文件搬运（split 同构重放），一字不经 LLM 之手（逐字一致红线）。
 * - 幂等：区间内已存在的段落跳过（重试/续跑安全）。
 * - 章引用回填同事务 append（发布结构随导入渐进完整）。
 * - 工具执行经原始（未守卫）novel handle 写库——守卫仍拦 paragraph.* /
 *   publication.* 的通用工具直写，本工具是唯一受控例外。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";
import { ProjectImportService } from "../../../import/ProjectImportService.js";
import type { NovelStore } from "../../../novel/store.js";
import type { NovelHandle } from "../../../novel/client/NovelHandle.js";

/** 工具依赖：workspace 根（批次文件定位）+ 原始 novel handle（未守卫写通道） */
export interface NovelImportTextDeps {
	readonly workspaceRoot: string;
	readonly handle: NovelHandle;
}

interface ImportItem {
	readonly unitId: string;
	readonly fromSeq: number;
	readonly toSeq: number;
}

function parseArgs(call: ToolCall): { items: ImportItem[] } {
	let parsed: { items?: unknown };
	try {
		parsed = JSON.parse(call.args) as { items?: unknown };
	} catch {
		throw new ToolError({ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name }, `无效的 JSON 参数: ${call.args}`);
	}
	if (!Array.isArray(parsed.items) || parsed.items.length === 0 || parsed.items.length > 64) {
		throw new ToolError({ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name }, "items 必须为 1-64 项的数组");
	}
	const items = parsed.items.map((raw, i) => {
		const v = raw as Partial<ImportItem>;
		if (typeof v.unitId !== "string" || v.unitId.trim().length === 0) {
			throw new ToolError({ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name }, `第 ${i + 1} 项缺少 unitId`);
		}
		if (!Number.isInteger(v.fromSeq) || !Number.isInteger(v.toSeq) || v.fromSeq! < 1 || v.toSeq! < v.fromSeq!) {
			throw new ToolError(
				{ code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
				`第 ${i + 1} 项区间非法：fromSeq/toSeq 须为正整数且 fromSeq ≤ toSeq（全书段落序，1 起）`,
			);
		}
		return { unitId: v.unitId!, fromSeq: v.fromSeq!, toSeq: v.toSeq! };
	});
	return { items };
}

/** 创建 NovelImportText 工具 */
export function createNovelImportTextTool(deps: NovelImportTextDeps): ToolDef {
	const service = new ProjectImportService();
	// NovelHandle 与 NovelStore 结构兼容（query/mutate/mutateBatch 同签名）——子进程
	// 侧经 WS 写主进程 store，与解构会话其他写同通道，不引入新并发面
	const store = deps.handle as unknown as NovelStore;
	return {
		name: "NovelImportText",
		version: "1.0.0",
		requireApproval: false,
		description: [
			"把导入书稿的原文段落按全书段落序区间落库到指定大纲单元（导入解构专用；正文从批次文件确定性搬运，本工具不接收任何文本）。章的发布引用随导入自动回填。",
			"",
			"## 段落坐标系",
			"- 全书段落从 1 起连续编号（自然段粒度，一段一句）；每批的区间见 manifest 的 paraStart/paraEnd。",
			"- 区间 [fromSeq, toSeq] 双端包含；可跨批次、可不足一批（场景边界按叙事精确到段，不必凑整批）。",
			"- 不同单元的区间不得重叠；全书所有区间应无缝衔接（下一段 = 上一区间 toSeq + 1）。",
			"",
			"## 用法",
			"- 建完一个幕/场景（NovelWrite kind=story_unit）后立即调用，把该单元覆盖的正文导入其名下。",
			"- items 批量：一轮读完可把本轮多个场景的区间一次导入（1-64 项）。",
			"- 幂等：已导入的段落自动跳过（重试/续跑安全）；返回 skipped 计数。",
			"- unitId 必须是已存在的大纲单元（先建后导）；超界区间报错（以 manifest 总段数为准）。",
			"",
			"## 返回",
			"每项 { unitId, imported, skipped, chapters } + 汇总 { imported, skipped }（JSON）。",
		].join("\n"),
		parameters: {
			type: "object",
			properties: {
				items: {
					type: "array",
					minItems: 1,
					maxItems: 64,
					description: "区间导入清单（每项一个单元的段落区间）",
					items: {
						type: "object",
						properties: {
							unitId: { type: "string", description: "目标大纲单元 id（须已存在——先 NovelWrite 建单元再导入）" },
							fromSeq: { type: "integer", minimum: 1, description: "区间起始段落全书序（含；1 起）" },
							toSeq: { type: "integer", minimum: 1, description: "区间结束段落全书序（含）" },
						},
						required: ["unitId", "fromSeq", "toSeq"],
						additionalProperties: false,
					},
				},
			},
			required: ["items"],
			additionalProperties: false,
		},
		promptDetail: {
			policy: "",
			guidance: "",
		},
		handler: {
			execute: async (call) => {
				const { items } = parseArgs(call);
				const results: Array<{ unitId: string; imported: number; skipped: number; chapters: string[] }> = [];
				for (const item of items) {
					const r = await service.importParagraphRange({
						workspaceRoot: deps.workspaceRoot,
						store,
						unitId: item.unitId,
						startSeq: item.fromSeq,
						endSeq: item.toSeq,
					});
					results.push({ unitId: item.unitId, ...r });
				}
				const total = results.reduce(
					(acc, r) => ({ imported: acc.imported + r.imported, skipped: acc.skipped + r.skipped }),
					{ imported: 0, skipped: 0 },
				);
				return JSON.stringify({ items: results, total }, null, 2);
			},
		},
	};
}
