/** Drains one ordered lifecycle Outbox into the durable Conversation Journal. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NOVEL_OUTBOX_DISPATCH_FAILURE,
  NovelOutboxDispatchError,
} from "../error/index.js";
import {
  NOVEL_LIFECYCLE_PUBLICATION_STATUS,
  NOVEL_OUTBOX_ATTEMPT_STATUS,
  NOVEL_OUTBOX_PUBLICATION_STATUS,
  type NovelLifecycleOutputPublisher,
  type NovelOutboxStore,
} from "../port/index.js";
import type {
  NovelOutboxEntry,
  NovelOutboxRecordIdentity,
  NovelOutboxSource,
} from "./NovelOutbox.js";

export interface NovelOutboxDispatcherOptions {
  readonly store: NovelOutboxStore;
  readonly publisher: NovelLifecycleOutputPublisher;
  readonly pageSize?: number;
  readonly logger?: Logger;
}

export interface NovelOutboxDispatchResult {
  readonly source: NovelOutboxSource;
  readonly attemptedCount: number;
  readonly recordedCount: number;
  readonly duplicateCount: number;
  readonly alreadyPublishedCount: number;
}

export class NovelOutboxDispatcher {
  private readonly store: NovelOutboxStore;
  private readonly publisher: NovelLifecycleOutputPublisher;
  private readonly pageSize: number;
  private readonly logger: Logger;

  constructor(options: NovelOutboxDispatcherOptions) {
    this.store = options.store;
    this.publisher = options.publisher;
    this.pageSize = capturePageSize(options.pageSize ?? 50);
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_outbox_dispatcher",
      sourceKind: options.store.source.kind,
      ...(options.store.source.kind === "draft"
        ? { draftSessionId: options.store.source.draftSessionId }
        : {}),
    });
  }

  async dispatchPending(): Promise<NovelOutboxDispatchResult> {
    let attemptedCount = 0;
    let recordedCount = 0;
    let duplicateCount = 0;
    let alreadyPublishedCount = 0;
    this.logger.debug("novel_outbox_dispatch.started", {
      pageSize: this.pageSize,
    });

    while (true) {
      const page = await this.store.listPending({ limit: this.pageSize });
      if (page.entries.length === 0) break;
      for (const entry of page.entries) {
        const identity = identityOf(entry);
        const attempt = await this.store.recordAttempt(identity);
        if (attempt.status === NOVEL_OUTBOX_ATTEMPT_STATUS.missing) {
          this.fail(NOVEL_OUTBOX_DISPATCH_FAILURE.attemptStateLost);
        }
        if (attempt.status === NOVEL_OUTBOX_ATTEMPT_STATUS.alreadyPublished) {
          alreadyPublishedCount += 1;
          continue;
        }
        attemptedCount += 1;

        let publication;
        try {
          publication = await this.publisher.publish(entry.record);
        } catch (error) {
          const failure =
            error instanceof NovelOutboxDispatchError
              ? error.failure
              : NOVEL_OUTBOX_DISPATCH_FAILURE.publisherFailed;
          this.fail(failure);
        }

        const marked = await this.store.markPublished({
          ...identity,
          publishedAt: publication.recordedAt,
        });
        if (marked.status === NOVEL_OUTBOX_PUBLICATION_STATUS.missing) {
          this.fail(NOVEL_OUTBOX_DISPATCH_FAILURE.publicationStateLost);
        }
        if (
          publication.status === NOVEL_LIFECYCLE_PUBLICATION_STATUS.recorded
        ) {
          recordedCount += 1;
        } else {
          duplicateCount += 1;
        }
      }
    }

    const result = Object.freeze({
      source: this.store.source,
      attemptedCount,
      recordedCount,
      duplicateCount,
      alreadyPublishedCount,
    });
    this.logger.info("novel_outbox_dispatch.completed", {
      attemptedCount,
      recordedCount,
      duplicateCount,
      alreadyPublishedCount,
    });
    return result;
  }

  private fail(failure: NovelOutboxDispatchError["failure"]): never {
    this.logger.error("novel_outbox_dispatch.failed", { failure });
    throw new NovelOutboxDispatchError(failure);
  }
}

function identityOf(entry: NovelOutboxEntry): NovelOutboxRecordIdentity {
  return Object.freeze({
    source: entry.source,
    novelId: entry.record.novelId,
    eventId: entry.record.eventId,
    recordDigest: entry.recordDigest,
  });
}

function capturePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new TypeError("Novel Outbox Dispatcher page size is invalid");
  }
  return value;
}
