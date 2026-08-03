/** Stable Tool Group Catalog failures containing only validated Group identity. */
export const TOOL_GROUP_CATALOG_FAILURE = {
  duplicateGroup: "duplicate_group",
  unknownGroup: "unknown_group",
} as const;

export type ToolGroupCatalogFailure =
  (typeof TOOL_GROUP_CATALOG_FAILURE)[keyof typeof TOOL_GROUP_CATALOG_FAILURE];

export class ToolGroupCatalogError extends Error {
  override readonly name = "ToolGroupCatalogError";
  readonly code = "TOOL_GROUP_CATALOG_FAILED" as const;

  constructor(
    public readonly failure: ToolGroupCatalogFailure,
    public readonly groupId?: string,
  ) {
    super("Tool Group Catalog operation failed");
  }
}
