/** Stable Nudge template failures without rendered Reminder or parameter data. */
export const NUDGE_TEMPLATE_FAILURE = {
  invalidTemplate: "invalid_template",
  duplicateTemplate: "duplicate_template",
  templateNotFound: "template_not_found",
  invalidNudges: "invalid_nudges",
  renderFailed: "render_failed",
  invalidRenderedOutput: "invalid_rendered_output",
} as const;

export type NudgeTemplateFailure =
  (typeof NUDGE_TEMPLATE_FAILURE)[keyof typeof NUDGE_TEMPLATE_FAILURE];

export class NudgeTemplateError extends Error {
  override readonly name = "NudgeTemplateError";
  readonly code = "NUDGE_TEMPLATE_FAILED" as const;

  constructor(
    public readonly failure: NudgeTemplateFailure,
    public readonly templateId?: string,
    public readonly templateVersion?: string,
  ) {
    super("Nudge template operation failed");
  }
}
