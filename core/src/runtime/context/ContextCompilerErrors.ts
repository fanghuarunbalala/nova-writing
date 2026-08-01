/** Stable Context compilation failures without prompt or Message contents. */
export const CONTEXT_COMPILE_FAILURE = {
  invalidRequest: "invalid_request",
  invalidMessage: "invalid_message",
  conversationMismatch: "conversation_mismatch",
  duplicateMessage: "duplicate_message",
} as const;

export type ContextCompileFailure =
  (typeof CONTEXT_COMPILE_FAILURE)[keyof typeof CONTEXT_COMPILE_FAILURE];

export class ContextCompileError extends Error {
  override readonly name = "ContextCompileError";
  readonly code = "CONTEXT_COMPILE_FAILED" as const;

  constructor(
    public readonly failure: ContextCompileFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
  ) {
    super("Runtime Context compilation failed");
  }
}
