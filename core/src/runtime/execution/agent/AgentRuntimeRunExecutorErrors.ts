/** Stable Agent Run execution failures without prompts, Messages, or raw causes. */
export const AGENT_RUNTIME_RUN_EXECUTION_FAILURE = {
  invalidRequest: "invalid_request",
  activeExecution: "active_execution",
  invalidRunState: "invalid_run_state",
  preparationFailed: "preparation_failed",
  invalidPreparation: "invalid_preparation",
  contextCompileFailed: "context_compile_failed",
  invalidCompiledContext: "invalid_compiled_context",
  adapterFailed: "adapter_failed",
  invalidAdapterResult: "invalid_adapter_result",
  invalidCancellationState: "invalid_cancellation_state",
  cancellationSettlementFailed: "cancellation_settlement_failed",
  terminalTransitionFailed: "terminal_transition_failed",
  invalidTerminalCommit: "invalid_terminal_commit",
} as const;

export type AgentRuntimeRunExecutionFailure =
  (typeof AGENT_RUNTIME_RUN_EXECUTION_FAILURE)[keyof typeof AGENT_RUNTIME_RUN_EXECUTION_FAILURE];

export class AgentRuntimeRunExecutorError extends Error {
  override readonly name = "AgentRuntimeRunExecutorError";
  readonly code = "AGENT_RUNTIME_RUN_EXECUTION_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly runId: string | undefined,
    public readonly failure: AgentRuntimeRunExecutionFailure,
  ) {
    super(`Agent Runtime Run execution failed: ${failure}`);
  }
}
