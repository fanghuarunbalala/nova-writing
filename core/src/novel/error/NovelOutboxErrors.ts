/** Content-safe lifecycle Outbox integrity failures without persisted row data. */
export const NOVEL_OUTBOX_INTEGRITY_FAILURE = {
  invalidRecord: "invalid_record",
  digestMismatch: "digest_mismatch",
  metadataMismatch: "metadata_mismatch",
} as const;

export type NovelOutboxIntegrityFailure =
  (typeof NOVEL_OUTBOX_INTEGRITY_FAILURE)[keyof typeof NOVEL_OUTBOX_INTEGRITY_FAILURE];

export class NovelOutboxIntegrityError extends Error {
  override readonly name = "NovelOutboxIntegrityError";
  readonly code = "NOVEL_OUTBOX_INTEGRITY_FAILED" as const;

  constructor(public readonly failure: NovelOutboxIntegrityFailure) {
    super("Novel lifecycle Outbox integrity validation failed");
  }
}
