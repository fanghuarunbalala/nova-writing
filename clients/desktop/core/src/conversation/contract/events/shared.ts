/**
 * 事件域共享字面类型（单一事实源）。
 * OutputEvent（持久化域）与 ProjectedEvent（流域）共用这些成员，保证
 * journal 重建序列与投影序列字段同构演化（PRD `output-投影层` §4.1）。
 */

import type { AgentId, ComposeModePhase, ConversationId, ConversationMode } from "../types/index.js";

/** 事件公共字段（两域共享） */
export interface ConversationEventBase {
	conversationId: ConversationId;
	agentId?: AgentId;
	ts: string;
	/**
	 * 事件流序号（child 侧 emit 盖章，逐会话单调递增；ZMQ fire-and-forget
	 * 通道的消费方断档检测用。journal 落盘/重放域不携带。gui-performance-2 功能点八）
	 */
	eseq?: number;
}

/** run 开始边界事件（runSeq = 本轮 run 序号） */
export interface RunStartEvent extends ConversationEventBase {
	type: "run-start";
	seq: number;
	runSeq: number;
}

/** run 结束边界事件 */
export interface RunEndEvent extends ConversationEventBase {
	type: "run-end";
	seq: number;
	runSeq: number;
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

/**
 * 助手流式增量（瞬态、流域专属：不落盘、无 seq）。
 * kind:"reasoning" 为思考心跳（gui-performance 一期的内容级 reasoning 流仍被丢弃）：
 * text 恒空、不携内容，chars = 本轮思考累计字符数（UI「深度思考中 · 约 N 字」进度用）。
 */
export interface AssistantDeltaEvent extends ConversationEventBase {
	type: "assistant.delta";
	kind?: "text" | "reasoning";
	text: string;
	/** 思考心跳携带：本轮 reasoning 累计字符数（仅 kind:"reasoning"） */
	chars?: number;
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

/**
 * compose/mode 边界事件（PRD `compose-mode`）：持久化成员落 state.jsonl sidecar
 * （非主 journal，sidecar 不打 seq → seq 可选）；payload 脱敏只带路径/相位等元信息，
 * 永不携带 design 文件内容。瞬态成员（mode.pending / compose.approved / compose.rejected）
 * 仅流域广播。
 */
export interface ComposeBeginEvent extends ConversationEventBase {
	type: "compose.begin";
	seq?: number;
	phase: ComposeModePhase;
	designFilePath: string;
	preComposeMode?: ConversationMode;
	hasPriorDraft?: boolean;
}

export interface ComposeSubmittedEvent extends ConversationEventBase {
	type: "compose.submitted";
	seq?: number;
	phase: ComposeModePhase;
	designFilePath?: string;
	approvalRequestId?: string;
}

export interface ComposeAppliedEvent extends ConversationEventBase {
	type: "compose.applied";
	seq?: number;
	phase: ComposeModePhase;
	designFilePath?: string;
	preComposeMode?: ConversationMode;
}

export interface ComposeDiscardedEvent extends ConversationEventBase {
	type: "compose.discarded";
	seq?: number;
	phase: ComposeModePhase;
	designFilePath?: string;
	preComposeMode?: ConversationMode;
}

/** 模式切换生效边界（持久化：state.jsonl；UI 模式栏权威回显源） */
export interface ModeChangedEvent extends ConversationEventBase {
	type: "mode.changed";
	seq?: number;
	mode: ConversationMode;
	designFilePath?: string;
	phase?: ComposeModePhase;
	preComposeMode?: ConversationMode;
}

/** 模式待生效（瞬态：mode.set 记录后广播，mode.changed 到达前 UI 显示「待生效」） */
export interface ModePendingEvent extends ConversationEventBase {
	type: "mode.pending";
	/** 瞬态标记（恒 false；显式携带便于构造处与断言处自文档） */
	persist?: false;
	mode: ConversationMode;
}

/** compose 退出决议：批准（瞬态） */
export interface ComposeApprovedEvent extends ConversationEventBase {
	type: "compose.approved";
	/** 瞬态标记（恒 false） */
	persist?: false;
	phase: ComposeModePhase;
	designFilePath?: string;
}

/** compose 退出决议：驳回（瞬态） */
export interface ComposeRejectedEvent extends ConversationEventBase {
	type: "compose.rejected";
	/** 瞬态标记（恒 false） */
	persist?: false;
	phase: ComposeModePhase;
	designFilePath?: string;
}

/** 两域共享事件联合（无 persist/落盘语义） */
export type SharedConversationEvent =
	| RunStartEvent
	| RunEndEvent
	| UserMessageEvent
	| AssistantMessageEvent
	| AssistantDeltaEvent
	| CompactedEvent
	| ClearEvent
	| RetryRequestEvent
	| ComposeBeginEvent
	| ComposeSubmittedEvent
	| ComposeAppliedEvent
	| ComposeDiscardedEvent
	| ComposeApprovedEvent
	| ComposeRejectedEvent
	| ModePendingEvent
	| ModeChangedEvent;

/** 持久化域标记：给共享事件附加 journal 落盘语义（persist: true 恒在） */
export type Persisted<T> = T & { persist: true };
