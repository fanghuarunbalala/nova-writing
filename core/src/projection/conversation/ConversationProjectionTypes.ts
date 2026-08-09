/** Immutable, platform-neutral Conversation views consumed by graphical and terminal clients. */
import type { RuntimePresence } from "../../conversation/RuntimePresence.js";
import type { ConversationMode } from "../../runtime/compose/index.js";
import type {
  AssistantMessageCompletionReason,
  AssistantMessageFailureCode,
  ToolApprovalResolutionDecision,
} from "../../event/index.js";
import type { ToolApprovalOperationSummary } from "../../event/output/payload/ToolApprovalLifecyclePayloads.js";
import type { JsonValue } from "../../event/protocol/index.js";
import type {
  RunStateChangeReason,
  RunStatus,
} from "../../runtime/execution/RunLifecycle.js";
import type {
  TurnStateChangeReason,
  TurnStatus,
} from "../../runtime/execution/TurnLifecycle.js";
import type { ExecutionCancellationReason } from "../../runtime/execution/ExecutionCancellationReason.js";

export type ConversationProjectionApplyResult = "applied" | "duplicate";

export interface ConversationEventDescriptor {
  readonly eventId: string;
  readonly sequence: number;
  readonly direction: "input" | "output";
  readonly eventType: string;
  /** 脱敏事件摘要（中文描述，不落 payload 内容/正文/参数）。Redacted event summary. */
  readonly summary?: string;
  readonly timestamp: string;
  readonly recordedAt: string;
  readonly runId?: string;
  readonly turnId?: string;
}

/** 脱敏工具调用摘要（用于对话内工具条聚合）。Redacted tool-trace summary. */
export interface ToolTraceSummaryProjection {
  readonly traceId: string;
  readonly toolName: string;
  readonly stage?: string;
  readonly outcome: "ok" | "failed";
  readonly durationMs?: number;
  readonly runId: string;
  readonly turnId?: string;
  readonly sequence: number;
  readonly timestamp: string;
}

export interface UserMessageProjection {
  readonly kind: "user-message";
  readonly eventId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly text: string;
  readonly runId?: string;
  readonly turnId?: string;
}

export interface AssistantTextContentProjection {
  readonly type: "text";
  readonly text: string;
}

export interface AssistantThinkingContentProjection {
  readonly type: "thinking";
  readonly thinking: string;
  readonly redacted?: boolean;
}

export type AssistantContentProjection =
  | AssistantTextContentProjection
  | AssistantThinkingContentProjection;

export type AssistantMessageProjectionStatus =
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export interface AssistantMessageProjection {
  readonly kind: "assistant-message";
  readonly assistantMessageId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly startedSequence: number;
  readonly lastSequence: number;
  readonly timestamp: string;
  readonly status: AssistantMessageProjectionStatus;
  readonly content: readonly AssistantContentProjection[];
  readonly completionReason?: AssistantMessageCompletionReason;
  readonly hasToolCalls?: boolean;
  readonly failureCode?: AssistantMessageFailureCode;
  /** 脱敏失败详情（中文摘要）。Redacted failure detail. */
  readonly failureDetail?: string;
}

export interface AgentRunProjection {
  readonly runId: string;
  readonly inputEventId: string;
  readonly inputEventType: string;
  readonly inputEventSequence: number;
  readonly previous: RunStatus | null;
  readonly current: RunStatus;
  readonly reason: RunStateChangeReason;
  readonly cancellationReason?: ExecutionCancellationReason;
  readonly lastSequence: number;
}

export interface AgentTurnProjection {
  readonly runId: string;
  readonly turnId: string;
  readonly previous: TurnStatus | null;
  readonly current: TurnStatus;
  readonly reason: TurnStateChangeReason;
  readonly cancellationReason?: ExecutionCancellationReason;
  readonly lastSequence: number;
}

export interface ToolApprovalProjection {
  readonly kind: "tool-approval";
  readonly approvalRequestId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: `sha256:${string}`;
  readonly runId: string;
  readonly turnId?: string;
  readonly requestedSequence: number;
  readonly lastSequence: number;
  readonly title: string;
  readonly description?: string;
  /** 完整工具参数（仅 pending 保留，决议后裁掉）。Full arguments while pending. */
  readonly arguments?: JsonValue;
  /** 每目标一行的操作摘要。Per-target operation rows. */
  readonly operations?: readonly ToolApprovalOperationSummary[];
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly status: "pending" | ToolApprovalResolutionDecision;
  readonly actorId?: string;
  readonly resolvedAt?: string;
}

export type ConversationTimelineItem =
  | UserMessageProjection
  | AssistantMessageProjection
  | ToolApprovalProjection;

export interface ConversationProjectionSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly lastAppliedSequence: number;
  readonly events: readonly ConversationEventDescriptor[];
  readonly toolTraces: readonly ToolTraceSummaryProjection[];
  readonly timeline: readonly ConversationTimelineItem[];
  readonly userMessages: readonly UserMessageProjection[];
  readonly assistantMessages: readonly AssistantMessageProjection[];
  readonly approvals: readonly ToolApprovalProjection[];
  readonly runs: readonly AgentRunProjection[];
  readonly turns: readonly AgentTurnProjection[];
  readonly runtimePresence?: RuntimePresence;
  /** 会话持久模式，connect 时由 DB 播种、`novel.mode.changed` 实时覆盖。 */
  /** Persistent conversation mode: seeded from the DB at connect, overlaid by novel.mode.changed. */
  readonly conversationMode?: ConversationMode;
  /** 活跃 compose 会话阶段，connect 时由 DB compose_state 播种、compose 事件实时覆盖。 */
  /** Active compose session phase: seeded from the DB at connect, overlaid by compose events. */
  readonly composePhase?: "designing" | "pending";
}

export type ConversationProjectionListener = () => void;
