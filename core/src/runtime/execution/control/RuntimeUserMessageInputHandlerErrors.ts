/** Stable UserMessage Run-claim errors without Input or executor failure content. */
export const RUNTIME_USER_MESSAGE_INPUT_FAILURE = {
  invalidInput: "invalid_input",
  activeRun: "active_run",
  beginRunFailed: "begin_run_failed",
  outcomeFailed: "outcome_failed",
  startRunFailed: "start_run_failed",
  executorFailed: "executor_failed",
  runNotTerminal: "run_not_terminal",
} as const;

export type RuntimeUserMessageInputFailure =
  (typeof RUNTIME_USER_MESSAGE_INPUT_FAILURE)[keyof typeof RUNTIME_USER_MESSAGE_INPUT_FAILURE];

export class RuntimeUserMessageInputHandlerError extends Error {
  override readonly name = "RuntimeUserMessageInputHandlerError";
  readonly code = "RUNTIME_USER_MESSAGE_INPUT_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly failure: RuntimeUserMessageInputFailure,
  ) {
    super(`Runtime UserMessage Input processing failed: ${failure}`);
  }
}
