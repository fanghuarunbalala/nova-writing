/**
 * Scenario-facing Conversation interaction model: typed view scenarios plus
 * the unified command surface consumed by every Conversation view.
 */
import type { InputReceipt } from "@novel/core";
import type { ConversationRuntimeStatus } from "@novel/core";
import type {
  AssistantContentProjection,
  AssistantMessageProjectionStatus,
  AssistantMessageCompletionReason,
  AssistantMessageFailureCode,
} from "@novel/core";

export interface UserMessageScenario {
  readonly kind: "user-message";
  readonly eventId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly text: string;
  readonly runId?: string;
}

export interface AssistantMessageScenario {
  readonly kind: "assistant-message";
  readonly assistantMessageId: string;
  readonly runId: string;
  readonly timestamp: string;
  readonly status: AssistantMessageProjectionStatus;
  readonly content: readonly AssistantContentProjection[];
  readonly completionReason?: AssistantMessageCompletionReason;
  readonly hasToolCalls?: boolean;
  readonly failureCode?: AssistantMessageFailureCode;
  readonly userText: string;
}

export interface ApprovalScenario {
  readonly kind: "tool-approval";
  readonly approvalRequestId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly argumentDigest: `sha256:${string}`;
  readonly title: string;
  readonly description?: string;
  readonly requestedAt: string;
  readonly status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
}

export type ConversationTimelineScenario =
  | UserMessageScenario
  | AssistantMessageScenario
  | ApprovalScenario;

export interface ConversationRuntimeScenario {
  readonly status: ConversationRuntimeStatus;
  readonly failureCode?: string;
  readonly canStop: boolean;
  readonly canRetry: boolean;
  readonly canOpenSettings: boolean;
}

export interface ConversationInteractionCommands {
  send(text: string): Promise<InputReceipt>;
  stop(): Promise<InputReceipt>;
  decideApproval(options: {
    readonly approvalRequestId: string;
    readonly decision: "approved" | "rejected";
    readonly argumentDigest: `sha256:${string}`;
  }): Promise<InputReceipt>;
  retryMessage(scenario: AssistantMessageScenario): Promise<InputReceipt>;
  editAndResend(text: string): Promise<InputReceipt>;
  clearContext(): Promise<InputReceipt>;
  compactContext(): Promise<InputReceipt>;
}

export interface ConversationInteraction {
  readonly scenarios: readonly ConversationTimelineScenario[];
  readonly runtime: ConversationRuntimeScenario;
  readonly commands: ConversationInteractionCommands;
}
