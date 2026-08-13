/**
 * CardProjection：把工具调用事件（tool-call-request/response）投影成卡片描述。
 * 变更类工具（*Write/*Edit/NovelDelete）→ proposal 卡；读类工具 → text 卡。
 */

import type { OutputEvent } from "./contract/events/index.js";

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
	/** 摘要（工具参数摘要） */
	summary?: string;
	/** 状态 */
	status: CardStatus;
}

/** 变更类工具后缀 */
const MUTATION_SUFFIXES = ["Write", "Edit"];

/** 工具名 → 卡片标题（域） */
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

/** 工具参数摘要（截断） */
function summaryOf(args: string): string | undefined {
	if (args === undefined || args === "") return undefined;
	return args.length > 120 ? `${args.slice(0, 120)}…` : args;
}

/** 工具调用 → 卡片投影器 */
export class CardProjection {
	private readonly cards = new Map<string, CardDescriptor>();

	/**
	 * 应用一条 OutputEvent（tool-call-request / tool-call-response）
	 * @param event 输出事件
	 */
	apply(event: OutputEvent): void {
		if (event.type === "tool-call-request") {
			if (!isMutation(event.name)) return;
			this.cards.set(event.toolCallId, {
				cardId: event.toolCallId,
				kind: "proposal",
				sourceSequence: event.seq,
				sourceEventId: event.toolCallId,
				toolName: event.name,
				title: titleOf(event.name),
				...(summaryOf(event.args) !== undefined ? { summary: summaryOf(event.args) } : {}),
				status: "in-progress",
			});
		} else if (event.type === "tool-call-response") {
			const card = this.cards.get(event.toolCallId);
			if (card) {
				this.cards.set(event.toolCallId, {
					...card,
					status: event.error !== undefined ? "failed" : "completed",
				});
			}
		}
	}

	/** 当前卡片列表（按源序列号排序） */
	getCards(): readonly CardDescriptor[] {
		return [...this.cards.values()].sort((a, b) => a.sourceSequence - b.sourceSequence);
	}
}
