/** Stable Tool Group Manifest failures without YAML content or parser diagnostics. */
export const TOOL_GROUP_MANIFEST_FAILURE = {
  parseFailed: "parse_failed",
  invalidStructure: "invalid_structure",
  unsupportedSchemaVersion: "unsupported_schema_version",
  invalidGroupId: "invalid_group_id",
  invalidGroupVersion: "invalid_group_version",
  invalidMetadata: "invalid_metadata",
  invalidToolList: "invalid_tool_list",
  invalidToolName: "invalid_tool_name",
  duplicateTool: "duplicate_tool",
} as const;

export type ToolGroupManifestFailure =
  (typeof TOOL_GROUP_MANIFEST_FAILURE)[keyof typeof TOOL_GROUP_MANIFEST_FAILURE];

export interface ToolGroupManifestErrorIdentity {
  readonly groupId?: string;
  readonly groupVersion?: string;
  readonly toolName?: string;
}

export class ToolGroupManifestError extends Error {
  override readonly name = "ToolGroupManifestError";
  readonly code = "TOOL_GROUP_MANIFEST_FAILED" as const;
  readonly groupId?: string;
  readonly groupVersion?: string;
  readonly toolName?: string;

  constructor(
    public readonly failure: ToolGroupManifestFailure,
    identity: ToolGroupManifestErrorIdentity = {},
  ) {
    super("Tool Group Manifest validation failed");
    this.groupId = identity.groupId;
    this.groupVersion = identity.groupVersion;
    this.toolName = identity.toolName;
  }
}
