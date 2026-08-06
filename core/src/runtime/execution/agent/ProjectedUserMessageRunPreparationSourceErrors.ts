/** Stable projected preparation failures without Prompt, Message, or path data. */
export const PROJECTED_RUN_PREPARATION_FAILURE = {
  invalidRequest: "invalid_request",
  projectionFailed: "projection_failed",
  projectionBehindInput: "projection_behind_input",
  basePromptFailed: "base_prompt_failed",
  invalidBasePrompt: "invalid_base_prompt",
  messageReadFailed: "message_read_failed",
  invalidMessagePage: "invalid_message_page",
  currentInputMessageMissing: "current_input_message_missing",
  currentInputMessageAmbiguous: "current_input_message_ambiguous",
} as const;

export type ProjectedRunPreparationFailure =
  (typeof PROJECTED_RUN_PREPARATION_FAILURE)[keyof typeof PROJECTED_RUN_PREPARATION_FAILURE];

export class ProjectedUserMessageRunPreparationError extends Error {
  override readonly name = "ProjectedUserMessageRunPreparationError";
  readonly code = "PROJECTED_USER_MESSAGE_RUN_PREPARATION_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly runId: string | undefined,
    public readonly failure: ProjectedRunPreparationFailure,
  ) {
    super(`Projected UserMessage Run preparation failed: ${failure}`);
  }
}
