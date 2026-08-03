/** Stable Registry failures containing Tool identity but no Tool arguments or results. */
export const TOOL_REGISTRY_FAILURE = {
  duplicateTool: "duplicate_tool",
  assemblyFrozen: "assembly_frozen",
  unknownTool: "unknown_tool",
} as const;

export type ToolRegistryFailure =
  (typeof TOOL_REGISTRY_FAILURE)[keyof typeof TOOL_REGISTRY_FAILURE];

export interface ToolRegistryErrorIdentity {
  readonly toolName?: string;
  readonly toolVersion?: string;
}

export class ToolRegistryError extends Error {
  override readonly name = "ToolRegistryError";
  readonly code = "TOOL_REGISTRY_FAILED" as const;
  readonly toolName?: string;
  readonly toolVersion?: string;

  constructor(
    public readonly failure: ToolRegistryFailure,
    identity: ToolRegistryErrorIdentity = {},
  ) {
    super("Tool Registry operation failed");
    this.toolName = identity.toolName;
    this.toolVersion = identity.toolVersion;
  }
}
