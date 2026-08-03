/** Immutable YAML-backed Tool Group metadata containing ordered Tool identities only. */
export const TOOL_GROUP_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface ToolGroupManifest {
  readonly schemaVersion: typeof TOOL_GROUP_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description?: string;
  readonly tools: readonly string[];
}
