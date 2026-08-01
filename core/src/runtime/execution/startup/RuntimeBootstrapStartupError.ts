/** Stable Bootstrap startup failure without payloads, paths, or raw causes. */
export const RUNTIME_BOOTSTRAP_STARTUP_FAILURE = {
  invalidBootstrap: "invalid_bootstrap",
  alreadyStarted: "already_started",
  replayFailed: "replay_failed",
  reconcileFailed: "reconcile_failed",
  recoveryRequired: "recovery_required",
  executionFailed: "execution_failed",
} as const;

export type RuntimeBootstrapStartupFailure =
  (typeof RUNTIME_BOOTSTRAP_STARTUP_FAILURE)[keyof typeof RUNTIME_BOOTSTRAP_STARTUP_FAILURE];

export class RuntimeBootstrapStartupError extends Error {
  readonly code = "RUNTIME_BOOTSTRAP_STARTUP_FAILED";

  constructor(
    public readonly conversationId: string,
    public readonly runtimeInstanceId: string,
    public readonly failure: RuntimeBootstrapStartupFailure,
  ) {
    super(`Runtime Bootstrap startup failed: ${failure}`);
    this.name = "RuntimeBootstrapStartupError";
  }
}
