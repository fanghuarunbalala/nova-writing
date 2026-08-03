/** Provider-neutral protocol for one asynchronous Tool approval interaction. */
import type {
  ToolApprovalIdentity,
} from "../tools/execution/ToolExecutionContracts.js";
import type {
  ToolApprovalResolutionDecision,
  ToolApprovalSummary,
} from "../../event/output/payload/ToolApprovalLifecyclePayloads.js";

export interface ToolApprovalRequest {
  readonly approvalRequestId: string;
  readonly identity: ToolApprovalIdentity;
  readonly turnId?: string;
  readonly summary: ToolApprovalSummary;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface ToolApprovalResolution {
  readonly approvalRequestId: string;
  readonly identity: ToolApprovalIdentity;
  readonly decision: ToolApprovalResolutionDecision;
  readonly actorId?: string;
  readonly resolvedAt: string;
  readonly causationId?: string;
}

export interface ToolApprovalTrustedCommandMetadata {
  readonly actorId: string;
}

export const TOOL_APPROVAL_DECISION_OUTCOME = {
  resolved: "resolved",
  duplicate: "duplicate",
  unknownRequest: "unknown_request",
  identityMismatch: "identity_mismatch",
} as const;

export type ToolApprovalDecisionOutcome =
  (typeof TOOL_APPROVAL_DECISION_OUTCOME)[keyof typeof TOOL_APPROVAL_DECISION_OUTCOME];

export interface ToolApprovalDecisionResult {
  readonly outcome: ToolApprovalDecisionOutcome;
  readonly resolution?: ToolApprovalResolution;
}

export interface ToolApprovalInteractionSnapshot {
  readonly schemaVersion: 1;
  readonly pending: readonly ToolApprovalRequest[];
  readonly resolved: readonly ToolApprovalResolution[];
}

export interface InteractionCoordinator {
  request(request: ToolApprovalRequest): Promise<ToolApprovalResolution>;

  wait(approvalRequestId: string): Promise<ToolApprovalResolution>;

  resolve(
    input: unknown,
    metadata: ToolApprovalTrustedCommandMetadata,
  ): Promise<ToolApprovalDecisionResult>;

  cancel(
    approvalRequestId: string,
    cancelledAt: string,
  ): Promise<ToolApprovalDecisionResult>;

  expire(evaluatedAt: string): Promise<readonly ToolApprovalResolution[]>;

  listPending(): Promise<readonly ToolApprovalRequest[]>;

  snapshot(): Promise<ToolApprovalInteractionSnapshot>;

  restore(snapshot: ToolApprovalInteractionSnapshot): Promise<void>;
}
