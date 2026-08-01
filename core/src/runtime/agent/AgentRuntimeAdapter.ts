/**
 * Provider-neutral execution port implemented by concrete Agent runtimes.
 *
 * Conversation callers depend on this Core contract rather than Pi, Provider,
 * process-placement, or future Rust implementation details.
 */
import type { RuntimeMessageSnapshot } from "../message/index.js";
import type { CompiledProviderContext } from "../context/index.js";
import type { ExecutionCancellationReason } from "../execution/index.js";

export const AGENT_RUNTIME_INVOCATION_KIND = {
  prompt: "prompt",
  continue: "continue",
} as const;

export type AgentRuntimeInvocationKind =
  (typeof AGENT_RUNTIME_INVOCATION_KIND)[keyof typeof AGENT_RUNTIME_INVOCATION_KIND];

export interface AgentRuntimePromptInvocation {
  readonly kind: "prompt";
  /** Messages appended after the compiled base transcript for this Run. */
  readonly messages: readonly RuntimeMessageSnapshot[];
}

export interface AgentRuntimeContinueInvocation {
  readonly kind: "continue";
}

export type AgentRuntimeInvocation =
  | AgentRuntimePromptInvocation
  | AgentRuntimeContinueInvocation;

export interface AgentRuntimeStreamRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly context: CompiledProviderContext;
  readonly invocation: AgentRuntimeInvocation;
}

export const AGENT_RUNTIME_OUTCOME = {
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type AgentRuntimeOutcome =
  (typeof AGENT_RUNTIME_OUTCOME)[keyof typeof AGENT_RUNTIME_OUTCOME];

export interface AgentRuntimeStreamResult {
  readonly conversationId: string;
  readonly runId: string;
  readonly outcome: AgentRuntimeOutcome;
}

export interface AgentRuntimeCancelRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly turnId?: string;
  readonly reason: ExecutionCancellationReason;
}

export interface AgentRuntimeAdapter {
  /** Execute one Core Run and settle only after awaited adapter event barriers. */
  stream(request: AgentRuntimeStreamRequest): Promise<AgentRuntimeStreamResult>;

  /** Idempotently cancel matching active Provider and adapter work. */
  cancel(request: AgentRuntimeCancelRequest): Promise<void>;
}
