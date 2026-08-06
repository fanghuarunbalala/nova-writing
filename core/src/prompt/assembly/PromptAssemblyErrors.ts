/** Stable failures for deterministic provider-call Prompt Assembly. */

export const PROMPT_ASSEMBLY_FAILURE = {
  invalidRequest: "invalid_request",
  invalidMessage: "invalid_message",
  conversationMismatch: "conversation_mismatch",
  duplicateMessage: "duplicate_message",
  invalidHighWatermark: "invalid_high_watermark",
} as const;

export type PromptAssemblyFailure =
  (typeof PROMPT_ASSEMBLY_FAILURE)[keyof typeof PROMPT_ASSEMBLY_FAILURE];

export class PromptAssemblyError extends Error {
  override readonly name = "PromptAssemblyError";

  constructor(
    readonly failure: PromptAssemblyFailure,
    readonly conversationId?: string,
    readonly runId?: string,
  ) {
    super(`Prompt Assembly failed (${failure})`);
  }
}
