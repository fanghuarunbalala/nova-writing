/** Reads and verifies ordered lifecycle Outbox pages from canonical or Draft SQLite. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_OUTBOX_INTEGRITY_FAILURE,
  NOVEL_OUTBOX_SOURCE_KIND,
  NovelOutboxIntegrityError,
  canonicalizeNovelLifecycleRecord,
  captureNovelDraftSession,
  captureNovelId,
  captureNovelLifecycleRecord,
  captureNovelOutboxEntry,
  captureNovelOutboxPage,
  captureNovelOutboxPageRequest,
  captureNovelOutboxRecordDigest,
  captureNovelOutboxSource,
  captureNovelWorkspaceId,
  type NovelDraftSession,
  type NovelId,
  type NovelLifecycleRecord,
  type NovelOutboxEntry,
  type NovelOutboxPage,
  type NovelOutboxPageRequest,
  type NovelOutboxReader,
  type NovelOutboxSource,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import { digestNovelLifecycleOutboxText } from "./NodeNovelLifecycleOutboxEncoder.js";

interface NovelOutboxRow {
  event_id: string;
  novel_id: string;
  conversation_id: string;
  event_type: string;
  schema_version: number;
  event_json: string;
  event_digest: string;
  created_at: string;
  published_at: string | null;
  attempt_count: number;
}

export interface SqliteNovelCanonicalOutboxReaderOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export interface SqliteNovelDraftOutboxReaderOptions {
  readonly location: NodeNovelStoreLocation;
  readonly session: NovelDraftSession;
  readonly logger?: Logger;
}

export class SqliteNovelOutboxReader implements NovelOutboxReader {
  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    readonly source: NovelOutboxSource,
    private readonly novelId: NovelId,
    private readonly tableName: "novel_outbox" | "draft_outbox",
    private readonly logger: Logger,
  ) {}

  static async openCanonical(
    options: SqliteNovelCanonicalOutboxReaderOptions,
  ): Promise<SqliteNovelOutboxReader> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const novelId = captureNovelId(options.novelId);
    const source = captureNovelOutboxSource({
      kind: NOVEL_OUTBOX_SOURCE_KIND.canonical,
    });
    const logger = createLogger(options.logger, workspaceId, novelId, source);
    return SqliteNovelOutboxReader.open({
      databasePath: options.location.canonicalDatabasePath,
      source,
      novelId,
      tableName: "novel_outbox",
      logger,
      validateIdentity: (database) => {
        const row = database
          .prepare(
            "SELECT novel_id, workspace_id FROM novel_metadata WHERE singleton = 1",
          )
          .get() as
          | { readonly novel_id: string; readonly workspace_id: string }
          | undefined;
        return row?.novel_id === novelId && row.workspace_id === workspaceId;
      },
      workspaceId,
    });
  }

  static async openDraft(
    options: SqliteNovelDraftOutboxReaderOptions,
  ): Promise<SqliteNovelOutboxReader> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const session = captureNovelDraftSession(options.session);
    const source = captureNovelOutboxSource({
      kind: NOVEL_OUTBOX_SOURCE_KIND.draft,
      draftSessionId: session.id,
    });
    const logger = createLogger(
      options.logger,
      workspaceId,
      session.novelId,
      source,
    );
    return SqliteNovelOutboxReader.open({
      databasePath: join(
        options.location.stagingDir,
        session.ownerConversationId,
        session.id,
        "draft.sqlite",
      ),
      source,
      novelId: session.novelId,
      tableName: "draft_outbox",
      logger,
      validateIdentity: (database) => {
        const row = database
          .prepare(
            `SELECT draft_session_id, novel_id, owner_conversation_id
             FROM draft_metadata WHERE singleton = 1`,
          )
          .get() as
          | {
              readonly draft_session_id: string;
              readonly novel_id: string;
              readonly owner_conversation_id: string;
            }
          | undefined;
        return (
          row?.draft_session_id === session.id &&
          row.novel_id === session.novelId &&
          row.owner_conversation_id === session.ownerConversationId
        );
      },
      workspaceId,
    });
  }

  private static open(options: OpenReaderOptions): SqliteNovelOutboxReader {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.databasePath, { readOnly: true });
      database.exec("PRAGMA busy_timeout = 5000");
      if (!options.validateIdentity(database)) throw new Error();
      database.prepare(
        `SELECT event_id, novel_id, conversation_id, event_type, schema_version,
                event_json, event_digest, created_at, published_at, attempt_count
         FROM ${options.tableName} LIMIT 0`,
      );
      options.logger.info("novel_outbox.open.completed");
      return new SqliteNovelOutboxReader(
        database,
        options.source,
        options.novelId,
        options.tableName,
        options.logger,
      );
    } catch {
      try {
        database?.close();
      } catch {}
      options.logger.error("novel_outbox.open.failed", {
        failure: NOVEL_DATABASE_FAILURE.invalidStructure,
      });
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        options.workspaceId,
        options.novelId,
      );
    }
  }

  async listPending(request: NovelOutboxPageRequest): Promise<NovelOutboxPage> {
    this.assertOpen();
    const captured = captureNovelOutboxPageRequest(request);
    this.logger.debug("novel_outbox.read.started", {
      limit: captured.limit,
      hasCursor: captured.after !== undefined,
    });
    try {
      const rows = this.readRows(captured);
      const entries = rows.map((row) => decodeRow(row, this.source, this.novelId));
      const page = captureNovelOutboxPage({
        entries,
        ...(entries.length === 0
          ? {}
          : {
              nextCursor: {
                createdAt: entries.at(-1)!.record.occurredAt,
                eventId: entries.at(-1)!.record.eventId,
              },
            }),
      });
      this.logger.info("novel_outbox.read.completed", {
        count: page.entries.length,
      });
      return page;
    } catch (error) {
      const failure =
        error instanceof NovelOutboxIntegrityError
          ? error.failure
          : NOVEL_DATABASE_FAILURE.invalidStructure;
      this.logger.error("novel_outbox.read.failed", { failure });
      if (error instanceof NovelOutboxIntegrityError) throw error;
      throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
    }
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
      this.logger.info("novel_outbox.close.completed");
    }
    return Promise.resolve();
  }

  private readRows(request: NovelOutboxPageRequest): NovelOutboxRow[] {
    if (request.after === undefined) {
      return this.database
        .prepare(
          `SELECT event_id, novel_id, conversation_id, event_type,
                  schema_version, event_json, event_digest, created_at,
                  published_at, attempt_count
           FROM ${this.tableName}
           WHERE published_at IS NULL
           ORDER BY created_at, event_id
           LIMIT ?`,
        )
        .all(request.limit) as unknown as NovelOutboxRow[];
    }
    return this.database
      .prepare(
        `SELECT event_id, novel_id, conversation_id, event_type,
                schema_version, event_json, event_digest, created_at,
                published_at, attempt_count
         FROM ${this.tableName}
         WHERE published_at IS NULL
           AND (created_at > ? OR (created_at = ? AND event_id > ?))
         ORDER BY created_at, event_id
         LIMIT ?`,
      )
      .all(
        request.after.createdAt,
        request.after.createdAt,
        request.after.eventId,
        request.limit,
      ) as unknown as NovelOutboxRow[];
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.closed);
    }
  }
}

interface OpenReaderOptions {
  readonly databasePath: string;
  readonly source: NovelOutboxSource;
  readonly novelId: NovelId;
  readonly tableName: "novel_outbox" | "draft_outbox";
  readonly logger: Logger;
  readonly validateIdentity: (database: DatabaseSync) => boolean;
  readonly workspaceId: string;
}

function decodeRow(
  row: NovelOutboxRow,
  source: NovelOutboxSource,
  novelId: NovelId,
): NovelOutboxEntry {
  let record: NovelLifecycleRecord;
  try {
    const parsed = JSON.parse(row.event_json) as NovelLifecycleRecord;
    record = captureNovelLifecycleRecord(parsed);
    if (canonicalizeNovelLifecycleRecord(record) !== row.event_json) {
      throw new Error();
    }
  } catch {
    throw new NovelOutboxIntegrityError(
      NOVEL_OUTBOX_INTEGRITY_FAILURE.invalidRecord,
    );
  }

  let storedDigest;
  try {
    storedDigest = captureNovelOutboxRecordDigest(row.event_digest);
  } catch {
    throw new NovelOutboxIntegrityError(
      NOVEL_OUTBOX_INTEGRITY_FAILURE.digestMismatch,
    );
  }
  if (storedDigest !== digestNovelLifecycleOutboxText(row.event_json)) {
    throw new NovelOutboxIntegrityError(
      NOVEL_OUTBOX_INTEGRITY_FAILURE.digestMismatch,
    );
  }
  if (
    row.published_at !== null ||
    row.event_id !== record.eventId ||
    row.novel_id !== novelId ||
    row.novel_id !== record.novelId ||
    row.conversation_id !== record.conversationId ||
    row.event_type !== `novel.${record.eventType}` ||
    row.schema_version !== NOVEL_LIFECYCLE_RECORD_VERSION ||
    row.schema_version !== record.recordVersion ||
    row.created_at !== record.occurredAt
  ) {
    throw new NovelOutboxIntegrityError(
      NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
    );
  }
  try {
    return captureNovelOutboxEntry({
      source,
      record,
      recordDigest: storedDigest,
      attemptCount: row.attempt_count,
    });
  } catch {
    throw new NovelOutboxIntegrityError(
      NOVEL_OUTBOX_INTEGRITY_FAILURE.metadataMismatch,
    );
  }
}

function createLogger(
  logger: Logger | undefined,
  workspaceId: string,
  novelId: NovelId,
  source: NovelOutboxSource,
): Logger {
  return (logger ?? noopLogger).child({
    component: "sqlite_novel_outbox_reader",
    workspaceId,
    novelId,
    sourceKind: source.kind,
    ...(source.kind === NOVEL_OUTBOX_SOURCE_KIND.draft
      ? { draftSessionId: source.draftSessionId }
      : {}),
  });
}
