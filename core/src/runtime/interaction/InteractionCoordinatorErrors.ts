/** Stable interaction failures without approval summaries, arguments, or causes. */
export const INTERACTION_COORDINATOR_FAILURE = {
  invalidRequest: "invalid_request",
  requestConflict: "request_conflict",
  requestPublicationFailed: "request_publication_failed",
  invalidDecisionInput: "invalid_decision_input",
  invalidTrustedMetadata: "invalid_trusted_metadata",
  resolutionPublicationFailed: "resolution_publication_failed",
  invalidTimestamp: "invalid_timestamp",
  invalidSnapshot: "invalid_snapshot",
  restoreConflict: "restore_conflict",
  unknownRequest: "unknown_request",
} as const;

export type InteractionCoordinatorFailure =
  (typeof INTERACTION_COORDINATOR_FAILURE)[keyof typeof INTERACTION_COORDINATOR_FAILURE];

export interface InteractionCoordinatorErrorIdentity {
  readonly conversationId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly approvalRequestId?: string;
  readonly inputEventId?: string;
}

export class InteractionCoordinatorError extends Error {
  override readonly name = "InteractionCoordinatorError";
  readonly code = "INTERACTION_COORDINATOR_FAILED" as const;
  readonly conversationId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly approvalRequestId?: string;
  readonly inputEventId?: string;

  constructor(
    public readonly failure: InteractionCoordinatorFailure,
    identity: InteractionCoordinatorErrorIdentity = {},
  ) {
    super("Runtime interaction coordination failed");
    this.conversationId = identity.conversationId;
    this.runId = identity.runId;
    this.toolCallId = identity.toolCallId;
    this.approvalRequestId = identity.approvalRequestId;
    this.inputEventId = identity.inputEventId;
  }
}
