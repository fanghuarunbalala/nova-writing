/** Validated lifecycle Outbox protocol shared by dispatchers and storage adapters. */
import {
  captureNovelDraftSessionId,
  captureNovelId,
  type NovelDraftSessionId,
  type NovelId,
} from "../identity/index.js";
import {
  captureNovelLifecycleEventId,
  captureNovelLifecycleRecord,
  type NovelLifecycleRecord,
} from "../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureNovelTimestamp,
  type NovelTimestamp,
} from "../version/index.js";

declare const novelOutboxRecordDigestBrand: unique symbol;

export type NovelOutboxRecordDigest = string & {
  readonly [novelOutboxRecordDigestBrand]: "NovelOutboxRecordDigest";
};

export const NOVEL_OUTBOX_SOURCE_KIND = {
  canonical: "canonical",
  draft: "draft",
} as const;

export type NovelOutboxSourceKind =
  (typeof NOVEL_OUTBOX_SOURCE_KIND)[keyof typeof NOVEL_OUTBOX_SOURCE_KIND];

export type NovelOutboxSource =
  | { readonly kind: "canonical" }
  | { readonly kind: "draft"; readonly draftSessionId: NovelDraftSessionId };

export interface NovelOutboxEntry {
  readonly source: NovelOutboxSource;
  readonly record: NovelLifecycleRecord;
  readonly recordDigest: NovelOutboxRecordDigest;
  readonly attemptCount: number;
}

export interface NovelOutboxCursor {
  readonly createdAt: NovelTimestamp;
  readonly eventId: string;
}

export interface NovelOutboxPageRequest {
  readonly after?: NovelOutboxCursor;
  readonly limit: number;
}

export interface NovelOutboxPage {
  readonly entries: readonly NovelOutboxEntry[];
  readonly nextCursor?: NovelOutboxCursor;
}

export interface NovelOutboxRecordIdentity {
  readonly source: NovelOutboxSource;
  readonly novelId: NovelId;
  readonly eventId: string;
  readonly recordDigest: NovelOutboxRecordDigest;
}

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function captureNovelOutboxRecordDigest(
  value: unknown,
): NovelOutboxRecordDigest {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) {
    throw invalid("lifecycleRecordDigest");
  }
  return value as NovelOutboxRecordDigest;
}

export function captureNovelOutboxSource(
  value: NovelOutboxSource,
): NovelOutboxSource {
  if (value.kind === NOVEL_OUTBOX_SOURCE_KIND.canonical) {
    return Object.freeze({ kind: NOVEL_OUTBOX_SOURCE_KIND.canonical });
  }
  if (value.kind === NOVEL_OUTBOX_SOURCE_KIND.draft) {
    return Object.freeze({
      kind: NOVEL_OUTBOX_SOURCE_KIND.draft,
      draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    });
  }
  throw invalid("outboxSource");
}

export function captureNovelOutboxEntry(
  value: NovelOutboxEntry,
): NovelOutboxEntry {
  return Object.freeze({
    source: captureNovelOutboxSource(value.source),
    record: captureNovelLifecycleRecord(value.record),
    recordDigest: captureNovelOutboxRecordDigest(value.recordDigest),
    attemptCount: captureAttemptCount(value.attemptCount),
  });
}

export function captureNovelOutboxCursor(
  value: NovelOutboxCursor,
): NovelOutboxCursor {
  return Object.freeze({
    createdAt: captureNovelTimestamp(value.createdAt),
    eventId: captureNovelLifecycleEventId(value.eventId),
  });
}

export function captureNovelOutboxPageRequest(
  value: NovelOutboxPageRequest,
): NovelOutboxPageRequest {
  if (!Number.isSafeInteger(value.limit) || value.limit < 1) {
    throw invalid("outboxPageRequest");
  }
  const after =
    value.after === undefined
      ? undefined
      : captureNovelOutboxCursor(value.after);
  return Object.freeze({
    ...(after === undefined ? {} : { after }),
    limit: value.limit,
  });
}

export function captureNovelOutboxPage(value: NovelOutboxPage): NovelOutboxPage {
  const entries = Object.freeze(value.entries.map(captureNovelOutboxEntry));
  for (let index = 1; index < entries.length; index += 1) {
    if (compareNovelOutboxEntries(entries[index - 1], entries[index]) >= 0) {
      throw invalid("outboxPage");
    }
  }
  const expectedCursor =
    entries.length === 0
      ? undefined
      : captureNovelOutboxCursor({
          createdAt: entries.at(-1)!.record.occurredAt,
          eventId: entries.at(-1)!.record.eventId,
        });
  if (
    (value.nextCursor === undefined) !== (expectedCursor === undefined) ||
    (value.nextCursor !== undefined &&
      compareNovelOutboxCursors(
        captureNovelOutboxCursor(value.nextCursor),
        expectedCursor!,
      ) !== 0)
  ) {
    throw invalid("outboxPage");
  }
  return Object.freeze({
    entries,
    ...(expectedCursor === undefined ? {} : { nextCursor: expectedCursor }),
  });
}

export function captureNovelOutboxRecordIdentity(
  value: NovelOutboxRecordIdentity,
): NovelOutboxRecordIdentity {
  return Object.freeze({
    source: captureNovelOutboxSource(value.source),
    novelId: captureNovelId(value.novelId),
    eventId: captureNovelLifecycleEventId(value.eventId),
    recordDigest: captureNovelOutboxRecordDigest(value.recordDigest),
  });
}

export function compareNovelOutboxEntries(
  left: NovelOutboxEntry,
  right: NovelOutboxEntry,
): number {
  return (
    compareText(left.record.occurredAt, right.record.occurredAt) ||
    compareText(left.record.eventId, right.record.eventId) ||
    compareText(sourceKey(left.source), sourceKey(right.source))
  );
}

function compareNovelOutboxCursors(
  left: NovelOutboxCursor,
  right: NovelOutboxCursor,
): number {
  return (
    compareText(left.createdAt, right.createdAt) ||
    compareText(left.eventId, right.eventId)
  );
}

function captureAttemptCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid("attemptCount");
  }
  return value;
}

function sourceKey(source: NovelOutboxSource): string {
  return source.kind === NOVEL_OUTBOX_SOURCE_KIND.canonical
    ? source.kind
    : `${source.kind}:${source.draftSessionId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(field: string): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOutbox,
    field,
  );
}
