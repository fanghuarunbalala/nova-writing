/**
 * 事件域共享字面类型（单一事实源）。
 * OutputEvent（持久化域）与 ProjectedEvent（流域）共用这些成员，保证
 * journal 重建序列与投影序列字段同构演化（PRD `output-投影层` §4.1）。
 */

import type { AgentId, ConversationId } from "../types/index.js";

/** 事件公共字段（两域共享） */
export interface ConversationEventBase {
	conversationId: ConversationId;
	agentId?: AgentId;
	ts: string;
}

/** turn 开始边界事件（turnSeq = 本轮 turn 序号） */
export interface TurnStartEvent extends ConversationEventBase {
	type: "turn-start";
	seq: number;
	turnSeq: number;
}

/** turn 结束边界事件 */
export interface TurnEndEvent extends ConversationEventBase {
	type: "turn-end";
	seq: number;
	turnSeq: number;
}

/** 用户消息事件 */
export interface UserMessageEvent extends ConversationEventBase {
	type: "user.message";
	seq: number;
	text: string;
}

/** 助手消息事件 */
export interface AssistantMessageEvent extends ConversationEventBase {
	type: "assistant.message";
	seq: number;
	text: string;
}

/** 助手流式增量（瞬态、流域专属：不落盘、无 seq） */
export interface AssistantDeltaEvent extends ConversationEventBase {
	type: "assistant.delta";
	kind?: "text" | "reasoning";
	text: string;
}

/** 上下文压缩边界事件 */
export interface CompactedEvent extends ConversationEventBase {
	type: "compacted";
	seq: number;
}

/** 会话清空边界事件 */
export interface ClearEvent extends ConversationEventBase {
	type: "clear";
	seq: number;
}

/** 重试请求边界事件 */
export interface RetryRequestEvent extends ConversationEventBase {
	type: "retry-request";
	seq: number;
}

/** 两域共享事件联合（无 persist/落盘语义） */
export type SharedConversationEvent =
	| TurnStartEvent
	| TurnEndEvent
	| UserMessageEvent
	| AssistantMessageEvent
	| AssistantDeltaEvent
	| CompactedEvent
	| ClearEvent
	| RetryRequestEvent;

/** 持久化域标记：给共享事件附加 journal 落盘语义（persist: true 恒在） */
export type Persisted<T> = T & { persist: true };
