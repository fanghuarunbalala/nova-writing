/**
 * 输出事件类型全集。
 * 输出事件是内存产物，默认瞬态；persist=true 才落 journal（可查/可恢复）。
 * 建模消息流（user/assistant/delta/tool-call）+ 会话边界事件（compose.* / mode.*）；
 * todo/run 状态等读 sqlite 读模型，不进事件。
 * compose/mode 事件 payload 脱敏：只带路径与相位等元信息，永不携带 design 文件内容。
 */

import type {
	AgentId,
	ComposeModePhase,
	ConversationId,
	ConversationMode,
} from "../types/index.js";

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
	  }
	| {
			type: "turn-start";
			persist: true;
			seq: number;
			turnSeq: number;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "turn-end";
			persist: true;
			seq: number;
			turnSeq: number;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compacted";
			persist: true;
			seq: number;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "clear";
			persist: true;
			seq: number;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "retry-request";
			persist: true;
			seq: number;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "approval.request";
			persist: false;
			requestId: string;
			toolName: string;
			args: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "approval.resolved";
			persist: false;
			requestId: string;
			decision: "approved" | "rejected" | "edited";
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compose.begin";
			persist: true;
			seq?: number;
			phase: ComposeModePhase;
			designFilePath: string;
			preComposeMode?: ConversationMode;
			hasPriorDraft?: boolean;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compose.submitted";
			persist: true;
			seq?: number;
			phase: ComposeModePhase;
			designFilePath?: string;
			approvalRequestId?: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compose.applied";
			persist: true;
			seq?: number;
			phase: ComposeModePhase;
			designFilePath?: string;
			preComposeMode?: ConversationMode;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compose.discarded";
			persist: true;
			seq?: number;
			phase: ComposeModePhase;
			designFilePath?: string;
			preComposeMode?: ConversationMode;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compose.approved";
			persist: false;
			phase: ComposeModePhase;
			designFilePath?: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "compose.rejected";
			persist: false;
			phase: ComposeModePhase;
			designFilePath?: string;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "mode.pending";
			persist: false;
			mode: ConversationMode;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  }
	| {
			type: "mode.changed";
			persist: true;
			seq?: number;
			mode: ConversationMode;
			designFilePath?: string;
			phase?: ComposeModePhase;
			preComposeMode?: ConversationMode;
			conversationId: ConversationId;
			agentId?: AgentId;
			ts: string;
	  };

/** 可落盘事件：OutputEvent 中 persist=true 的子集（journal 只写这些） */
export type PersistedOutputEvent = Extract<OutputEvent, { persist: true }>;
