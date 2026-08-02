/** Stable Novel Approval interaction failures without request or ChangeSet content. */
export const NOVEL_APPROVAL_BRIDGE_FAILURE = {
  requestConflict: "request_conflict",
  requestPublicationFailed: "request_publication_failed",
  invalidPublisherReceipt: "invalid_publisher_receipt",
  invalidDecisionInput: "invalid_decision_input",
  approvalGrantFailed: "approval_grant_failed",
} as const;

export type NovelApprovalBridgeFailure =
  (typeof NOVEL_APPROVAL_BRIDGE_FAILURE)[keyof typeof NOVEL_APPROVAL_BRIDGE_FAILURE];

export class NovelApprovalBridgeError extends Error {
  override readonly name = "NovelApprovalBridgeError";
  readonly code = "NOVEL_APPROVAL_BRIDGE_FAILED" as const;

  constructor(public readonly failure: NovelApprovalBridgeFailure) {
    super("Novel Approval interaction failed");
  }
}
