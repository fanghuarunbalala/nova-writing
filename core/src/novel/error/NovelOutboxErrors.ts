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

export const NOVEL_OUTBOX_DISPATCH_FAILURE = {
  publisherFailed: "publisher_failed",
  invalidPublisherReceipt: "invalid_publisher_receipt",
  attemptStateLost: "attempt_state_lost",
  publicationStateLost: "publication_state_lost",
} as const;

export type NovelOutboxDispatchFailure =
  (typeof NOVEL_OUTBOX_DISPATCH_FAILURE)[keyof typeof NOVEL_OUTBOX_DISPATCH_FAILURE];

export class NovelOutboxDispatchError extends Error {
  override readonly name = "NovelOutboxDispatchError";
  readonly code = "NOVEL_OUTBOX_DISPATCH_FAILED" as const;

  constructor(public readonly failure: NovelOutboxDispatchFailure) {
    super("Novel lifecycle Outbox dispatch failed");
  }
}
