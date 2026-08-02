/** Stable Novel foundation validation failures without rejected values or content. */
export const NOVEL_PROTOCOL_FAILURE = {
  invalidIdentity: "invalid_identity",
  invalidRevision: "invalid_revision",
  invalidSchemaVersion: "invalid_schema_version",
  invalidEntityVersion: "invalid_entity_version",
  invalidTimestamp: "invalid_timestamp",
  invalidDraftStatus: "invalid_draft_status",
  invalidOperation: "invalid_operation",
  invalidOperationVersion: "invalid_operation_version",
  invalidOperationDigest: "invalid_operation_digest",
  invalidChangeSetDigest: "invalid_change_set_digest",
} as const;

export type NovelProtocolFailure =
  (typeof NOVEL_PROTOCOL_FAILURE)[keyof typeof NOVEL_PROTOCOL_FAILURE];

const NOVEL_PROTOCOL_FIELDS = new Set([
  "novelId",
  "draftSessionId",
  "operationId",
  "commitId",
  "conflictId",
  "artifactId",
  "workspaceId",
  "conversationId",
  "revision",
  "schemaVersion",
  "entityVersion",
  "timestamp",
  "draftStatus",
  "operationType",
  "operationVersion",
  "operationPayload",
  "operationPrecondition",
  "operationDigest",
  "changeSetDigest",
  "characterId",
  "locationId",
  "entityProfile",
]);

export class NovelProtocolValidationError extends Error {
  override readonly name = "NovelProtocolValidationError";
  readonly code = "NOVEL_PROTOCOL_VALIDATION_FAILED" as const;
  readonly field?: string;

  constructor(
    public readonly failure: NovelProtocolFailure,
    field?: string,
  ) {
    super("Novel protocol validation failed");
    this.field = captureSafeFailureToken(field);
  }
}

function captureSafeFailureToken(value: unknown): string | undefined {
  return typeof value === "string" && NOVEL_PROTOCOL_FIELDS.has(value)
    ? value
    : undefined;
}
