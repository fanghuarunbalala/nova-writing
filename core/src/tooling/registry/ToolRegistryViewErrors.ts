/** Stable Registry View failures without Tool metadata, schemas, or policy sources. */
export const TOOL_REGISTRY_VIEW_FAILURE = {
  invalidPolicy: "invalid_policy",
  duplicateGroupSelection: "duplicate_group_selection",
  duplicateAllowTool: "duplicate_allow_tool",
  duplicateDenyTool: "duplicate_deny_tool",
  unknownTool: "unknown_tool",
} as const;

export type ToolRegistryViewFailure =
  (typeof TOOL_REGISTRY_VIEW_FAILURE)[keyof typeof TOOL_REGISTRY_VIEW_FAILURE];

export interface ToolRegistryViewErrorIdentity {
  readonly groupId?: string;
  readonly toolName?: string;
}

export class ToolRegistryViewError extends Error {
  override readonly name = "ToolRegistryViewError";
  readonly code = "TOOL_REGISTRY_VIEW_FAILED" as const;
  readonly groupId?: string;
  readonly toolName?: string;

  constructor(
    public readonly failure: ToolRegistryViewFailure,
    identity: ToolRegistryViewErrorIdentity = {},
  ) {
    super("Tool Registry View construction failed");
    this.groupId = identity.groupId;
    this.toolName = identity.toolName;
  }
}
