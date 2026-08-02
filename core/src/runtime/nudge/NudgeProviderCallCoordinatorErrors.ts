/** Stable Provider-call Nudge coordination failures without private content. */
export const NUDGE_PROVIDER_CALL_FAILURE = {
  invalidRequest: "invalid_request",
  prepareFailed: "prepare_failed",
  privateStateCommitFailed: "private_state_commit_failed",
  confirmationFailed: "confirmation_failed",
  eventAppendFailed: "event_append_failed",
  releaseFailed: "release_failed",
} as const;

export type NudgeProviderCallFailure =
  (typeof NUDGE_PROVIDER_CALL_FAILURE)[keyof typeof NUDGE_PROVIDER_CALL_FAILURE];

export class NudgeProviderCallCoordinatorError extends Error {
  override readonly name = "NudgeProviderCallCoordinatorError";
  readonly code = "NUDGE_PROVIDER_CALL_COORDINATION_FAILED" as const;

  constructor(
    public readonly failure: NudgeProviderCallFailure,
    public readonly conversationId?: string,
    public readonly runId?: string,
    public readonly providerCallId?: string,
  ) {
    super("Nudge Provider call coordination failed");
  }
}
