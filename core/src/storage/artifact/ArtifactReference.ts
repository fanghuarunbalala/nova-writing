/** Stable logical reference to durable Conversation-owned oversized content. */
export const ARTIFACT_REFERENCE_SCHEMA_VERSION = 1 as const;

export interface ArtifactReference {
  readonly schemaVersion: typeof ARTIFACT_REFERENCE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly conversationId: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly tokenEstimate?: number;
  /** Canonical digest including its algorithm prefix, for example `sha256:...`. */
  readonly digest: string;
  readonly filename?: string;
}
