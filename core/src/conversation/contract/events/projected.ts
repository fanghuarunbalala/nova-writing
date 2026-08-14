/**
 * ProjectedEvent：事件流投影（流域，hub 广播 + projectedHistory 读取形态）。
 * 由 ProjectionLayer 从 OutputEvent 映射而来；与重建序列同构的部分复用 shared.ts 字面，
 * 工具调用以 tool-recorded.started/recorded 替代完整 request/response。
 * 映射方向 OutputEvent → ProjectedEvent 确定可重放，反向不可逆（投影丢失完整 args/result）；
 * 投影事件一律瞬态、不落 journal（PRD `output-投影层`）。
 */

import type { ConversationEventBase, SharedConversationEvent } from "./shared.js";

/** 工具投影预览内容（ToolDef.preview 产出：动作标识 + 内容 + 摘要） */
export interface ToolPreview {
	/** 动作词（编辑/创建/插入…；与 object 组合成「动作+对象」标识） */
	action?: string;
	/** 对象词（角色/正文/文件…） */
	object?: string;
	/** 内容（张三 / ch3 / 设定.md） */
	title?: string;
	/** 结果摘要（卡片摘要 / 详情 tooltip） */
	summary?: string;
}

/** 工具调用投影：开始事件（tool-call-request 的投影，preview 为 preview(args) 输出） */
export interface ToolRecordedStartedEvent extends ConversationEventBase {
	type: "tool-recorded.started";
	/** 源 turn seq（UI 归属/去重/分页必需） */
	seq: number;
	toolCallId: string;
	name: string;
	preview?: ToolPreview;
}

/** 工具调用投影：完成事件（tool-call-response 的投影，preview 为 preview(args, response) 输出） */
export interface ToolRecordedRecordedEvent extends ConversationEventBase {
	type: "tool-recorded.recorded";
	/** 源 turn seq（同 started） */
	seq: number;
	toolCallId: string;
	name: string;
	/** 终态结果（failed 由 response.error 推导） */
	outcome: "ok" | "failed";
	preview?: ToolPreview;
	/** 失败短信息（截断，非完整 error） */
	error?: string;
	/** request→response 耗时毫秒 */
	durationMs?: number;
}

/** 投影事件全集（hub 订阅与 projectedHistory 读取的唯二形态，UI 只消费此类型） */
export type ProjectedEvent =
	| SharedConversationEvent
	| ToolRecordedStartedEvent
	| ToolRecordedRecordedEvent;
