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
