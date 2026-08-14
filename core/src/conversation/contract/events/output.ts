/**
 * 输出事件（持久化域）全集：journal 落盘与重建的事实源。
 * 与流域共享的字面（消息/run 边界等）复用 shared.ts 并附加 persist: true；
 * tool-call-request/response 为持久化域专属（完整 args/result，重建必需）；
 * assistant.delta 已移入流域、approval 事件已删除（wait 权威在 CMS 队列，PRD `output-投影层`）。
 * 只建模消息流（user/assistant/tool-call/边界）；todo/run 状态等读 sqlite 读模型，不进事件。
 * compose/mode 边界事件（PRD `compose-mode`）持久化在 state.jsonl sidecar（非主 journal）：
 * 此处进 union 仅为复用 PersistedOutputEvent 类型（sidecar 写侧/读侧共用），主 journal 不写这些。
 */

import type { AgentId, ConversationId } from "../types/index.js";
import type {
	AssistantMessageEvent,
	ClearEvent,
	CompactedEvent,
	ComposeApprovedEvent,
	ComposeAppliedEvent,
	ComposeBeginEvent,
	ComposeDiscardedEvent,
	ComposeRejectedEvent,
	ComposeSubmittedEvent,
	ModeChangedEvent,
	ModePendingEvent,
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

/** 输出事件全集（持久化域：全部 persist=true；主 journal 只写前九类，compose/mode 走 sidecar） */
export type OutputEvent =
	| Persisted<RunStartEvent>
	| Persisted<RunEndEvent>
	| Persisted<UserMessageEvent>
	| Persisted<AssistantMessageEvent>
	| Persisted<CompactedEvent>
	| Persisted<ClearEvent>
	| Persisted<RetryRequestEvent>
	| ToolCallRequestEvent
	| ToolCallResponseEvent
	| Persisted<ComposeBeginEvent>
	| Persisted<ComposeSubmittedEvent>
	| Persisted<ComposeAppliedEvent>
	| Persisted<ComposeDiscardedEvent>
	| Persisted<ModeChangedEvent>;

/** 可落盘事件：OutputEvent 中 persist=true 的子集（主 journal 与 state sidecar 共用） */
export type PersistedOutputEvent = Extract<OutputEvent, { persist: true }>;

/**
 * 状态事件全集（state sidecar 域，PRD `compose-mode`）：persist 成员落 state.jsonl +
 * hub 广播；瞬态成员（mode.pending / compose.approved / compose.rejected）仅广播。
 * emitState / ComposeEventSink 的参数类型。
 */
export type StateEvent =
	| Persisted<ComposeBeginEvent>
	| Persisted<ComposeSubmittedEvent>
	| Persisted<ComposeAppliedEvent>
	| Persisted<ComposeDiscardedEvent>
	| Persisted<ModeChangedEvent>
	| ComposeApprovedEvent
	| ComposeRejectedEvent
	| ModePendingEvent;
