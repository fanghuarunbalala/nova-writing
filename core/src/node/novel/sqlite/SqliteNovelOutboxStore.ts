/** Atomically records attempts and publication state for lifecycle Outbox rows. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_OUTBOX_ATTEMPT_STATUS,
  NOVEL_OUTBOX_INTEGRITY_FAILURE,
  NOVEL_OUTBOX_PUBLICATION_STATUS,
  NOVEL_OUTBOX_SOURCE_KIND,
  NovelOutboxIntegrityError,
  captureNovelDraftSession,
  captureNovelId,
  captureNovelOutboxRecordIdentity,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type NovelDraftSession,
  type NovelId,
  type NovelOutboxAttemptReceipt,
  type NovelOutboxPage,
  type NovelOutboxPageRequest,
  type NovelOutboxPublicationReceipt,
  type NovelOutboxPublicationRequest,
  type NovelOutboxRecordIdentity,
  type NovelOutboxSource,
  type NovelOutboxStore,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import {
  SqliteNovelOutboxReader,
  type SqliteNovelCanonicalOutboxReaderOptions,
  type SqliteNovelDraftOutboxReaderOptions,
} from "./SqliteNovelOutboxReader.js";

interface ExistingDeliveryRow {
  readonly novel_id: string;
  readonly event_digest: string;
  readonly published_at: string | null;
  readonly attempt_count: number;
}

interface OpenStoreOptions {
  readonly databasePath: string;
  readonly tableName: "novel_outbox" | "draft_outbox";
  readonly reader: SqliteNovelOutboxReader;
  readonly novelId: NovelId;
  readonly workspaceId: string;
  readonly logger: Logger;
}

export class SqliteNovelOutboxStore implements NovelOutboxStore {
  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly reader: SqliteNovelOutboxReader,
    readonly source: NovelOutboxSource,
    private readonly novelId: NovelId,
    private readonly workspaceId: string,
    private readonly tableName: "novel_outbox" | "draft_outbox",
    private readonly logger: Logger,
  ) {}

  static async openCanonical(
    options: SqliteNovelCanonicalOutboxReaderOptions,
  ): Promise<SqliteNovelOutboxStore> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const novelId = captureNovelId(options.novelId);
    const reader = await SqliteNovelOutboxReader.openCanonical(options);
    return SqliteNovelOutboxStore.open({
      databasePath: options.location.canonicalDatabasePath,
      tableName: "novel_outbox",
      reader,
      novelId,
      workspaceId,
      logger: createLogger(options.logger, workspaceId, novelId, reader.source),
    });
  }

  static async openDraft(
    options: SqliteNovelDraftOutboxReaderOptions,
  ): Promise<SqliteNovelOutboxStore> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const session = captureNovelDraftSession(options.session);
    const reader = await SqliteNovelOutboxReader.openDraft(options);
    return SqliteNovelOutboxStore.open({
      databasePath: join(
        options.location.stagingDir,
        session.ownerConversationId,
        session.id,
        "draft.sqlite",
      ),
      tableName: "draft_outbox",
      reader,
      novelId: session.novelId,
      workspaceId,
      logger: createLogger(
        options.logger,
        workspaceId,
        session.novelId,
        reader.source,
      ),
    });
  }

  private static open(options: OpenStoreOptions): SqliteNovelOutboxStore {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.databasePath);
      configure(database);
      database.prepare(
        `SELECT event_id, novel_id, event_digest, published_at, attempt_count
         FROM ${options.tableName} LIMIT 0`,
      );
      options.logger.info("novel_outbox_store.open.completed");
      return new SqliteNovelOutboxStore(
        database,
        options.reader,
        options.reader.source,
        options.novelId,
        options.workspaceId,
        options.tableName,
        options.logger,
      );
    } catch {
      try {
        database?.close();
      } catch {}
      void options.reader.close();
      options.logger.error("novel_outbox_store.open.failed", {
        failure: NOVEL_DATABASE_FAILURE.invalidStructure,
      });
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        options.workspaceId,
        options.novelId,
      );
    }
  }

  listPending(request: NovelOutboxPageRequest): Promise<NovelOutboxPage> {
    this.assertOpen();
    return this.reader.listPending(request);
  }

  async recordAttempt(
    identityInput: NovelOutboxRecordIdentity,
  ): Promise<NovelOutboxAttemptReceipt> {
    this.assertOpen();
    const identity = this.captureIdentity(identityInput);
    this.logger.debug("novel_outbox_store.attempt.started");
    try {
      const updated = this.database
        .prepare(
          `UPDATE ${this.tableName}
           SET attempt_count = attempt_count + 1
           WHERE event_id = ? AND novel_id = ? AND event_digest = ?
             AND published_at IS NULL
           RETURNING attempt_count`,
        )
        .get(identity.eventId, identity.novelId, identity.recordDigest) as
        | { readonly attempt_count: number }
        | undefined;
      const receipt =
        updated === undefined
          ? this.classifyAttemptMiss(identity)
          : Object.freeze({
              status: NOVEL_OUTBOX_ATTEMPT_STATUS.recorded,
              attemptCount: captureAttemptCount(updated.attempt_count),
            });
      this.logger.info("novel_outbox_store.attempt.completed", {
        status: receipt.status,
        ...(receipt.status === NOVEL_OUTBOX_ATTEMPT_STATUS.missing
          ? {}
          : { attemptCount: receipt.attemptCount }),
      });
      return receipt;
    } catch (error) {
      this.throwWriteFailure("novel_outbox_store.attempt.failed", error);
    }
  }

  async markPublished(
    requestInput: NovelOutboxPublicationRequest,
  ): Promise<NovelOutboxPublicationReceipt> {
    this.assertOpen();
    const identity = this.captureIdentity(requestInput);
    const publishedAt = captureNovelTimestamp(requestInput.publishedAt);
    this.logger.debug("novel_outbox_store.publish.started");
    try {
      const updated = this.database
        .prepare(
          `UPDATE ${this.tableName}
           SET published_at = ?
           WHERE event_id = ? AND novel_id = ? AND event_digest = ?
             AND published_at IS NULL
           RETURNING published_at`,
        )
        .get(
          publishedAt,
          identity.eventId,
          identity.novelId,
          identity.recordDigest,
        ) as { readonly published_at: string } | undefined;
      const receipt =
        updated === undefined
          ? this.classifyPublicationMiss(identity)
          : Object.freeze({
              status: NOVEL_OUTBOX_PUBLICATION_STATUS.published,
              publishedAt: captureNovelTimestamp(updated.published_at),
            });
      this.logger.info("novel_outbox_store.publish.completed", {
        status: receipt.status,
      });
      return receipt;
    } catch (error) {
      this.throwWriteFailure("novel_outbox_store.publish.failed", error);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    await this.reader.close();
    this.closed = true;
    this.logger.info("novel_outbox_store.close.completed");
  }

  private classifyAttemptMiss(
    identity: NovelOutboxRecordIdentity,
  ): NovelOutboxAttemptReceipt {
    const existing = this.readExisting(identity.eventId);
    if (existing === undefined) {
      return Object.freeze({ status: NOVEL_OUTBOX_ATTEMPT_STATUS.missing });
    }
    this.assertExistingIdentity(existing, identity);
    if (existing.published_at === null) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        this.workspaceId,
        this.novelId,
      );
    }
    return Object.freeze({
      status: NOVEL_OUTBOX_ATTEMPT_STATUS.alreadyPublished,
      attemptCount: captureAttemptCount(existing.attempt_count),
    });
  }

  private classifyPublicationMiss(
    identity: NovelOutboxRecordIdentity,
  ): NovelOutboxPublicationReceipt {
    const existing = this.readExisting(identity.eventId);
    if (existing === undefined) {
      return Object.freeze({ status: NOVEL_OUTBOX_PUBLICATION_STATUS.missing });
    }
    this.assertExistingIdentity(existing, identity);
    if (existing.published_at === null) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        this.workspaceId,
        this.novelId,
      );
    }
    return Object.freeze({
      status: NOVEL_OUTBOX_PUBLICATION_STATUS.alreadyPublished,
      publishedAt: captureNovelTimestamp(existing.published_at),
    });
  }

  private readExisting(eventId: string): ExistingDeliveryRow | undefined {
    return this.database
      .prepare(
        `SELECT novel_id, event_digest, published_at, attempt_count
         FROM ${this.tableName} WHERE event_id = ?`,
      )
      .get(eventId) as ExistingDeliveryRow | undefined;
  }

  private assertExistingIdentity(
    existing: ExistingDeliveryRow,
    identity: NovelOutboxRecordIdentity,
  ): void {
    if (existing.novel_id !== identity.novelId) {
      throw new NovelOutboxIntegrityError(
        NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
      );
    }
    if (existing.event_digest !== identity.recordDigest) {
      throw new NovelOutboxIntegrityError(
        NOVEL_OUTBOX_INTEGRITY_FAILURE.digestMismatch,
      );
    }
  }

  private captureIdentity(
    input: NovelOutboxRecordIdentity,
  ): NovelOutboxRecordIdentity {
    const identity = captureNovelOutboxRecordIdentity(input);
    if (
      identity.novelId !== this.novelId ||
      !sameSource(identity.source, this.source)
    ) {
      throw new NovelOutboxIntegrityError(
        NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
      );
    }
    return identity;
  }

  private throwWriteFailure(event: string, error: unknown): never {
    const failure =
      error instanceof NovelOutboxIntegrityError
        ? error.failure
        : error instanceof NovelDatabaseError
          ? error.failure
          : NOVEL_DATABASE_FAILURE.invalidStructure;
    this.logger.error(event, { failure });
    if (
      error instanceof NovelOutboxIntegrityError ||
      error instanceof NovelDatabaseError
    ) {
      throw error;
    }
    throw new NovelDatabaseError(
      NOVEL_DATABASE_FAILURE.invalidStructure,
      this.workspaceId,
      this.novelId,
    );
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.closed,
        this.workspaceId,
        this.novelId,
      );
    }
  }
}

function sameSource(left: NovelOutboxSource, right: NovelOutboxSource): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === NOVEL_OUTBOX_SOURCE_KIND.canonical ||
      (right.kind === NOVEL_OUTBOX_SOURCE_KIND.draft &&
        left.draftSessionId === right.draftSessionId))
  );
}

function captureAttemptCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new NovelOutboxIntegrityError(
      NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
    );
  }
  return value as number;
}

function createLogger(
  logger: Logger | undefined,
  workspaceId: string,
  novelId: NovelId,
  source: NovelOutboxSource,
): Logger {
  return (logger ?? noopLogger).child({
    component: "sqlite_novel_outbox_store",
    workspaceId,
    novelId,
    sourceKind: source.kind,
    ...(source.kind === NOVEL_OUTBOX_SOURCE_KIND.draft
      ? { draftSessionId: source.draftSessionId }
      : {}),
  });
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
