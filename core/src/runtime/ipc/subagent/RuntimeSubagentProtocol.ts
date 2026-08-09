/**
 * 固定 Runtime 子代理窄 RPC 白名单与可序列化请求/响应契约。
 * Fixed Runtime subagent narrow-RPC allowlist and serializable request/response contracts.
 */
import type {
  ConversationRuntimeActivationResult,
  ConversationRuntimeShutdownReason,
  ConversationRuntimeShutdownResult,
} from "../../../conversation/host/index.js";
import type { InputReceipt } from "../../../event/index.js";
import type { ArtifactReference } from "../../../storage/artifact/index.js";

export const RUNTIME_SUBAGENT_RPC_METHOD = Object.freeze({
  ensureActive: "subagent.ensureActive",
  shutdownRuntime: "subagent.shutdownRuntime",
  enqueue: "subagent.enqueue",
  readChildRunTerminal: "subagent.readChildRunTerminal",
  readChildFinalAssistantMessage: "subagent.readChildFinalAssistantMessage",
} as const);

export type RuntimeSubagentRpcMethod =
  (typeof RUNTIME_SUBAGENT_RPC_METHOD)[keyof typeof RUNTIME_SUBAGENT_RPC_METHOD];

export interface RuntimeSubagentEnsureActiveRequest {
  readonly conversationId: string;
}

export type RuntimeSubagentEnsureActiveResponse =
  ConversationRuntimeActivationResult;

export interface RuntimeSubagentShutdownRuntimeRequest {
  readonly conversationId: string;
  readonly reason: ConversationRuntimeShutdownReason;
}

export type RuntimeSubagentShutdownRuntimeResponse =
  ConversationRuntimeShutdownResult;

export interface RuntimeSubagentEnqueueRequest {
  readonly conversationId: string;
  readonly taskId: string;
  readonly requesterConversationId: string;
  readonly prompt: string;
  readonly artifactReferences: readonly ArtifactReference[];
}

export type RuntimeSubagentEnqueueResponse = InputReceipt;

export interface RuntimeSubagentReadChildRunTerminalRequest {
  readonly conversationId: string;
}

/** 子会话 Run 的终态（completed/failed/cancelled），供父进程惰性终结子代理 binding。
 *  Terminal state of a child conversation Run observed by the parent for lazy
 *  subagent binding finalization. Mirrors `SubagentTerminalRunObservation`
 *  minus the `subagentId` field. */
export type RuntimeSubagentChildRunTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled";

export type RuntimeSubagentReadChildRunTerminalResponse =
  | Readonly<{
      found: true;
      status: RuntimeSubagentChildRunTerminalStatus;
      completedAt: string;
      cancellationReason?: string;
      errorCode?: string;
    }>
  | Readonly<{ found: false }>;

export interface RuntimeSubagentReadChildFinalAssistantMessageRequest {
  readonly conversationId: string;
}

/** 子会话最终 assistant 消息正文摘要，供父进程组装 completed 结果 summary。
 *  Final assistant message text of a child conversation used by the parent to
 *  build the completed subagent result summary. */
export type RuntimeSubagentReadChildFinalAssistantMessageResponse =
  | Readonly<{ found: true; content: string }>
  | Readonly<{ found: false }>;
