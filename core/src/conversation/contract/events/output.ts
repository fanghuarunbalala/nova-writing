/**
 * 输出事件类型全集。
 * 输出事件是内存产物，默认瞬态；persist=true 才落 journal（可查/可恢复）。
 * 只建模消息流（user/assistant/delta/tool-call）；todo/run 状态等读 sqlite 读模型，不进事件。
 */

import type { AgentId, ConversationId } from "../types/index.js";

/**
 * 输出事件（hub + journal 共用）：
 * - persist=true：落 journal（带 seq），可查 / 可恢复；
 * - persist=false（assistant.delta）：瞬态，仅订阅者可见，事后不可查。
 */
export type OutputEvent =
	| {
			type: "user.message";
			persist: true;
			seq: number;
			text: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "assistant.message";
			persist: true;
			seq: number;
			text: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "assistant.delta";
			persist: false;
			kind?: "text" | "reasoning";
			text: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
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
	| {
			type: "tool-call-response";
			persist: true;
			seq: number;
			toolCallId: string;
			result?: string;
			error?: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  };

/** 可落盘事件：OutputEvent 中 persist=true 的子集（journal 只写这些） */
export type PersistedOutputEvent = Extract<OutputEvent, { persist: true }>;
