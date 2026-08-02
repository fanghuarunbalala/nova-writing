/** Stable permission-policy failures containing only safe rule and Tool identities. */
export const TOOL_PERMISSION_POLICY_FAILURE = {
  invalidRule: "invalid_rule",
  duplicateRule: "duplicate_rule",
  invalidEvaluation: "invalid_evaluation",
  invalidApprovalGrant: "invalid_approval_grant",
} as const;

export type ToolPermissionPolicyFailure =
  (typeof TOOL_PERMISSION_POLICY_FAILURE)[keyof typeof TOOL_PERMISSION_POLICY_FAILURE];

export interface ToolPermissionPolicyErrorIdentity {
  readonly ruleId?: string;
  readonly toolName?: string;
}

export class ToolPermissionPolicyError extends Error {
  override readonly name = "ToolPermissionPolicyError";
  readonly code = "TOOL_PERMISSION_POLICY_FAILED" as const;
  readonly ruleId?: string;
  readonly toolName?: string;

  constructor(
    public readonly failure: ToolPermissionPolicyFailure,
    identity: ToolPermissionPolicyErrorIdentity = {},
  ) {
    super("Tool permission policy operation failed");
    this.ruleId = identity.ruleId;
    this.toolName = identity.toolName;
  }
}
