/** Provider-neutral asynchronous decision protocol for Novel ChangeSet review. */
import type { NovelApprovalRequest } from "./NovelApprovalRequest.js";

export type NovelApprovalResolutionDecision =
  | "approved"
  | "rejected"
  | "stale";

export interface NovelApprovalResolution {
  readonly request: NovelApprovalRequest;
  readonly decision: NovelApprovalResolutionDecision;
  readonly inputEventId: string;
  readonly resolvedAt: string;
}

export const NOVEL_APPROVAL_DECISION_OUTCOME = {
  resolved: "resolved",
  duplicate: "duplicate",
  unknownRequest: "unknown_request",
  identityMismatch: "identity_mismatch",
  staleChangeSet: "stale_change_set",
} as const;

export type NovelApprovalDecisionOutcome =
  (typeof NOVEL_APPROVAL_DECISION_OUTCOME)[keyof typeof NOVEL_APPROVAL_DECISION_OUTCOME];

export interface NovelApprovalDecisionResult {
  readonly outcome: NovelApprovalDecisionOutcome;
  readonly resolution?: NovelApprovalResolution;
}
