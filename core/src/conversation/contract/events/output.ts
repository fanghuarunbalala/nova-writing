/**
 * 输出事件（持久化域）全集：journal 落盘与重建的事实源。
 * 与流域共享的字面（消息/run 边界等）复用 shared.ts 并附加 persist: true；
 * tool-call-request/response 为持久化域专属（完整 args/result，重建必需）；
 * assistant.delta 已移入流域、approval 事件已删除（wait 权威在 CMS 队列，PRD `output-投影层`）。
 * 只建模消息流（user/assistant/tool-call/边界）；todo/run 状态等读 sqlite 读模型，不进事件。
 */

import type { AgentId, ConversationId } from "../types/index.js";
import type {
	AssistantMessageEvent,
	ClearEvent,
	CompactedEvent,
	Persisted,
	RetryRequestEvent,
	RunEndEvent,
	RunStartEvent,
	UserMessageEvent,
} from "./shared.js";

/** 工具调用请求（完整 args，重建必需，不广播给 UI） */
interface ToolCallRequestEvent {
	type: "tool-call-request";
	persist: true;
	seq: number;
	toolCallId: string;
	name: string;
	args: string;
	conversationId: ConversationId;
	agentId?: AgentId;
	ts: string;
}

/** 工具调用响应（完整 result/error，重建必需，不广播给 UI） */
interface ToolCallResponseEvent {
	type: "tool-call-response";
	persist: true;
	seq: number;
	toolCallId: string;
	result?: string;
	error?: string;
	conversationId: ConversationId;
	agentId?: AgentId;
	ts: string;
}

/** 输出事件全集（持久化域：全部 persist=true，journal 只写这些） */
export type OutputEvent =
	| Persisted<RunStartEvent>
	| Persisted<RunEndEvent>
	| Persisted<UserMessageEvent>
	| Persisted<AssistantMessageEvent>
	| Persisted<CompactedEvent>
	| Persisted<ClearEvent>
	| Persisted<RetryRequestEvent>
	| ToolCallRequestEvent
	| ToolCallResponseEvent;

/** 可落盘事件：OutputEvent 中 persist=true 的子集（全部成员，保留兼容） */
export type PersistedOutputEvent = Extract<OutputEvent, { persist: true }>;
