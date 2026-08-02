/** Stable Artifact-reference validation failures without paths or content. */
export const ARTIFACT_REFERENCE_VALIDATION_FAILURE = {
  invalidReference: "invalid_reference",
} as const;

export type ArtifactReferenceValidationFailure =
  (typeof ARTIFACT_REFERENCE_VALIDATION_FAILURE)[keyof typeof ARTIFACT_REFERENCE_VALIDATION_FAILURE];

export class ArtifactReferenceValidationError extends Error {
  override readonly name = "ArtifactReferenceValidationError";
  readonly code = "ARTIFACT_REFERENCE_VALIDATION_FAILED" as const;

  constructor(
    public readonly failure: ArtifactReferenceValidationFailure,
    public readonly artifactId?: string,
    public readonly conversationId?: string,
  ) {
    super("Artifact reference validation failed");
  }
}
