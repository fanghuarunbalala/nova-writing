/** Immutable, platform-neutral Conversation views consumed by graphical and terminal clients. */
import type { RuntimePresence } from "../../conversation/RuntimePresence.js";
import type {
  AssistantMessageCompletionReason,
  AssistantMessageFailureCode,
  ToolApprovalResolutionDecision,
} from "../../event/index.js";
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
  readonly timestamp: string;
  readonly recordedAt: string;
  readonly runId?: string;
  readonly turnId?: string;
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
  readonly requestedSequence: number;
  readonly lastSequence: number;
  readonly title: string;
  readonly description?: string;
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
  readonly timeline: readonly ConversationTimelineItem[];
  readonly userMessages: readonly UserMessageProjection[];
  readonly assistantMessages: readonly AssistantMessageProjection[];
  readonly approvals: readonly ToolApprovalProjection[];
  readonly runs: readonly AgentRunProjection[];
  readonly turns: readonly AgentTurnProjection[];
  readonly runtimePresence?: RuntimePresence;
}

export type ConversationProjectionListener = () => void;
