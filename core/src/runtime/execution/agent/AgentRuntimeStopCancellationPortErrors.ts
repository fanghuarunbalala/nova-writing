/** Stable Stop-to-Agent cancellation failures without Adapter error content. */
export const AGENT_RUNTIME_STOP_CANCELLATION_FAILURE = {
  invalidRequest: "invalid_request",
  adapterFailed: "adapter_failed",
} as const;

export type AgentRuntimeStopCancellationFailure =
  (typeof AGENT_RUNTIME_STOP_CANCELLATION_FAILURE)[keyof typeof AGENT_RUNTIME_STOP_CANCELLATION_FAILURE];

export class AgentRuntimeStopCancellationPortError extends Error {
  override readonly name = "AgentRuntimeStopCancellationPortError";
  readonly code = "AGENT_RUNTIME_STOP_CANCELLATION_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly runId: string | undefined,
    public readonly failure: AgentRuntimeStopCancellationFailure,
  ) {
    super(`Agent Runtime Stop cancellation failed: ${failure}`);
  }
}
