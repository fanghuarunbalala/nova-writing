/**
 * CardProjection：把工具调用投影事件（tool-recorded.started/recorded）投影成卡片描述。
 * 变更类工具（*Write/*Edit/NovelDelete）→ proposal 卡；读类工具 → text 卡。
 * 标题/摘要由投影层的 preview 提供（PRD `output-投影层` §4.7），客户端不再做 args 截断。
 */

import type { ProjectedEvent } from "./contract/events/index.js";

/** 卡片状态 */
export type CardStatus = "in-progress" | "completed" | "failed";

/** 卡片种类 */
export type CardKind = "proposal" | "text";

/** 卡片描述 */
export interface CardDescriptor {
	/** 卡片 id（= toolCallId） */
	cardId: string;
	/** 种类 */
	kind: CardKind;
	/** 源事件序列号 */
	sourceSequence: number;
	/** 源事件 id */
	sourceEventId: string;
	/** 工具名 */
	toolName: string;
	/** 标题 */
	title: string;
	/** 摘要（投影层 preview 提供） */
	summary?: string;
	/** 状态 */
	status: CardStatus;
}

/** 变更类工具后缀 */
const MUTATION_SUFFIXES = ["Write", "Edit"];

/** 工具名 → 卡片标题（域，preview 无 title 时的兜底） */
function titleOf(toolName: string): string {
	if (toolName === "NovelDelete") return "删除";
	if (toolName.startsWith("Character")) return "角色";
	if (toolName.startsWith("Location")) return "地点";
	if (toolName.startsWith("Outline")) return "大纲";
	if (toolName.startsWith("Paragraph")) return "正文";
	if (toolName.startsWith("Publication")) return "发布";
	return toolName;
}

/** 是否变更类工具（proposal 卡） */
function isMutation(toolName: string): boolean {
	if (toolName === "NovelDelete") return true;
	return MUTATION_SUFFIXES.some((suffix) => toolName.endsWith(suffix));
}

/** 工具调用投影 → 卡片投影器 */
export class CardProjection {
	private readonly cards = new Map<string, CardDescriptor>();

	/**
	 * 应用一条 ProjectedEvent（tool-recorded.started / tool-recorded.recorded）
	 * @param event 投影事件
	 */
	apply(event: ProjectedEvent): void {
		if (event.type === "tool-recorded.started") {
			if (!isMutation(event.name)) return;
			this.cards.set(event.toolCallId, {
				cardId: event.toolCallId,
				kind: "proposal",
				sourceSequence: event.seq,
				sourceEventId: event.toolCallId,
				toolName: event.name,
				// preview.title 为纯内容（张三）→ 卡片标题补域标识（角色：张三）
				title:
					event.preview?.title !== undefined
						? `${titleOf(event.name)}：${event.preview.title}`
						: titleOf(event.name),
				...(event.preview?.summary !== undefined ? { summary: event.preview.summary } : {}),
				status: "in-progress",
			});
		} else if (event.type === "tool-recorded.recorded") {
			const card = this.cards.get(event.toolCallId);
			if (card) {
				this.cards.set(event.toolCallId, {
					...card,
					...(event.preview?.summary !== undefined ? { summary: event.preview.summary } : {}),
					status: event.outcome === "failed" ? "failed" : "completed",
				});
			}
		}
	}

	/** 当前卡片列表（按源序列号排序） */
	getCards(): readonly CardDescriptor[] {
		return [...this.cards.values()].sort((a, b) => a.sourceSequence - b.sourceSequence);
	}
}
