/** Persistence boundary for ordered, idempotent Novel lifecycle Outbox delivery. */
import type {
  NovelOutboxPage,
  NovelOutboxPageRequest,
  NovelOutboxRecordIdentity,
  NovelOutboxSource,
} from "../outbox/index.js";
import type { NovelTimestamp } from "../version/index.js";

export const NOVEL_OUTBOX_ATTEMPT_STATUS = {
  recorded: "recorded",
  alreadyPublished: "already-published",
  missing: "missing",
} as const;

export type NovelOutboxAttemptStatus =
  (typeof NOVEL_OUTBOX_ATTEMPT_STATUS)[keyof typeof NOVEL_OUTBOX_ATTEMPT_STATUS];

export type NovelOutboxAttemptReceipt =
  | {
      readonly status:
        | typeof NOVEL_OUTBOX_ATTEMPT_STATUS.recorded
        | typeof NOVEL_OUTBOX_ATTEMPT_STATUS.alreadyPublished;
      readonly attemptCount: number;
    }
  | { readonly status: typeof NOVEL_OUTBOX_ATTEMPT_STATUS.missing };

export const NOVEL_OUTBOX_PUBLICATION_STATUS = {
  published: "published",
  alreadyPublished: "already-published",
  missing: "missing",
} as const;

export type NovelOutboxPublicationStatus =
  (typeof NOVEL_OUTBOX_PUBLICATION_STATUS)[keyof typeof NOVEL_OUTBOX_PUBLICATION_STATUS];

export interface NovelOutboxPublicationRequest
  extends NovelOutboxRecordIdentity {
  readonly publishedAt: NovelTimestamp;
}

export type NovelOutboxPublicationReceipt =
  | {
      readonly status:
        | typeof NOVEL_OUTBOX_PUBLICATION_STATUS.published
        | typeof NOVEL_OUTBOX_PUBLICATION_STATUS.alreadyPublished;
      readonly publishedAt: NovelTimestamp;
    }
  | { readonly status: typeof NOVEL_OUTBOX_PUBLICATION_STATUS.missing };

export interface NovelOutboxStore {
  readonly source: NovelOutboxSource;

  listPending(request: NovelOutboxPageRequest): Promise<NovelOutboxPage>;

  recordAttempt(
    identity: NovelOutboxRecordIdentity,
  ): Promise<NovelOutboxAttemptReceipt>;

  markPublished(
    request: NovelOutboxPublicationRequest,
  ): Promise<NovelOutboxPublicationReceipt>;
}
