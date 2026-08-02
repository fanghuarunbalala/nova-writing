/** Stable private Pi adapter failures without Provider or event contents. */
export const PI_AGENT_CORE_ADAPTER_FAILURE = {
  invalidRequest: "invalid_request",
  activeRun: "active_run",
  messageConversion: "message_conversion",
  eventBarrier: "event_barrier",
  execution: "execution",
  invalidResult: "invalid_result",
  providerDispatchProtocol: "provider_dispatch_protocol",
  cancellationConflict: "cancellation_conflict",
  cancellation: "cancellation",
} as const;

export type PiAgentCoreAdapterFailure =
  (typeof PI_AGENT_CORE_ADAPTER_FAILURE)[keyof typeof PI_AGENT_CORE_ADAPTER_FAILURE];

export class PiAgentCoreAdapterError extends Error {
  override readonly name = "PiAgentCoreAdapterError";
  readonly code = "PI_AGENT_CORE_ADAPTER_FAILED" as const;

  constructor(
    public readonly failure: PiAgentCoreAdapterFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
  ) {
    super("Agent Runtime adapter failed");
  }
}
