/** Executes one Handler and Draft Journal append in one short SQLite transaction. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelDraftOperationPersistenceError,
  NovelInvariantViolationError,
  NovelOperationHandlerNotFoundError,
  NovelOperationIdentityConflictError,
  NovelOperationSynchronousHandlerError,
  NovelProtocolValidationError,
  canonicalizeNovelOperation,
  captureNovelDraftSession,
  captureNovelId,
  captureNovelOperation,
  captureNovelOperationDigest,
  captureNovelTimestamp,
  type AppendNovelDraftOperationInput,
  type NovelDraftOperationReceipt,
  type NovelDraftOperationStore,
  type NovelId,
} from "../../../novel/index.js";
import { canonicalStringifyJson } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { digestNovelSha256Text } from "./NodeSha256NovelOperationDigester.js";

interface DraftMetadataRow {
  draft_session_id: string;
  novel_id: string;
  owner_conversation_id: string;
  base_revision: string;
  operation_count: number;
  last_operation_sequence: number;
}

interface ExistingOperationRow {
  sequence: number;
  operation_digest: string;
}

export interface SqliteNovelDraftOperationStoreOptions<TContext> {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly contextFactory: (database: DatabaseSync) => TContext;
  readonly logger?: Logger;
}

export class SqliteNovelDraftOperationStore<TContext>
  implements NovelDraftOperationStore<TContext>
{
  private readonly logger: Logger;
  private readonly novelId: NovelId;

  constructor(
    private readonly options: SqliteNovelDraftOperationStoreOptions<TContext>,
  ) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_draft_operation_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  async appendOperation(
    input: AppendNovelDraftOperationInput<TContext>,
  ): Promise<NovelDraftOperationReceipt> {
    const session = captureNovelDraftSession(input.session);
    const operation = captureNovelOperation(input.operation);
    const recordedAt = captureNovelTimestamp(input.recordedAt);
    const digest = captureNovelOperationDigest(input.digest);
    if (session.novelId !== this.novelId) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.novelIdentityMismatch,
        this.novelId,
        session.id,
      );
    }
    const canonicalOperation = canonicalizeNovelOperation(operation);
    if (digestNovelSha256Text(canonicalOperation) !== digest) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
      );
    }

    this.logger.debug("novel_draft_operation.transaction.started", {
      novelId: session.novelId,
      draftSessionId: session.id,
      operationId: operation.operationId,
      operationType: operation.type,
      operationVersion: operation.operationVersion,
    });
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(this.databasePath(session));
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const metadata = readMetadata(database);
      assertSession(metadata, session);
      const existing = database
        .prepare(
          "SELECT sequence, operation_digest FROM draft_operations WHERE operation_id = ?",
        )
        .get(operation.operationId) as ExistingOperationRow | undefined;
      if (existing !== undefined) {
        if (existing.operation_digest !== digest) {
          throw new NovelOperationIdentityConflictError(
            operation.operationId,
            session.id,
          );
        }
        database.exec("COMMIT");
        transactionStarted = false;
        this.logger.debug("novel_draft_operation.transaction.duplicate", {
          novelId: session.novelId,
          draftSessionId: session.id,
          operationId: operation.operationId,
          sequence: existing.sequence,
        });
        return Object.freeze({
          status: "duplicate",
          sequence: existing.sequence,
          digest,
        });
      }

      const sequence = metadata.last_operation_sequence + 1;
      database
        .prepare(
          `INSERT INTO draft_operations(
             sequence, operation_id, operation_type, operation_version,
             operation_json, operation_digest, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sequence,
          operation.operationId,
          operation.type,
          operation.operationVersion,
          canonicalOperation,
          digest,
          recordedAt,
        );
      input.apply(this.options.contextFactory(database));
      const update = database
        .prepare(
          `UPDATE draft_metadata
           SET operation_count = ?, last_operation_sequence = ?,
               last_operation_digest = ?, updated_at = ?
           WHERE singleton = 1 AND operation_count = ?
             AND last_operation_sequence = ?`,
        )
        .run(
          metadata.operation_count + 1,
          sequence,
          digest,
          recordedAt,
          metadata.operation_count,
          metadata.last_operation_sequence,
        );
      if (Number(update.changes) !== 1) {
        throw new NovelInvariantViolationError(
          NOVEL_INVARIANT_FAILURE.persistenceInvariant,
          session.novelId,
          session.id,
        );
      }

      const eventJson = canonicalStringifyJson({
        draftSessionId: session.id,
        operationId: operation.operationId,
        operationType: operation.type,
        operationVersion: operation.operationVersion,
        sequence,
      });
      database
        .prepare(
          `INSERT INTO draft_outbox(
             event_id, operation_sequence, operation_id, event_type,
             event_json, event_digest, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `draft-operation:${operation.operationId}`,
          sequence,
          operation.operationId,
          "novel.draft.operation-applied",
          eventJson,
          digestNovelSha256Text(eventJson),
          recordedAt,
        );
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.info("novel_draft_operation.transaction.completed", {
        novelId: session.novelId,
        draftSessionId: session.id,
        operationId: operation.operationId,
        sequence,
      });
      return Object.freeze({ status: "appended", sequence, digest });
    } catch (error) {
      if (transactionStarted) {
        try {
          database?.exec("ROLLBACK");
        } catch {}
      }
      this.logger.info("novel_draft_operation.transaction.failed", {
        novelId: session.novelId,
        draftSessionId: session.id,
        operationId: operation.operationId,
      });
      if (isSafeOperationError(error)) throw error;
      throw new NovelDraftOperationPersistenceError(
        session.id,
        operation.operationId,
      );
    } finally {
      try {
        database?.close();
      } catch {}
    }
  }

  private databasePath(session: AppendNovelDraftOperationInput<TContext>["session"]): string {
    return join(
      this.options.location.stagingDir,
      session.ownerConversationId,
      session.id,
      "draft.sqlite",
    );
  }
}

function readMetadata(database: DatabaseSync): DraftMetadataRow {
  const row = database
    .prepare(
      `SELECT draft_session_id, novel_id, owner_conversation_id,
              base_revision, operation_count, last_operation_sequence
       FROM draft_metadata WHERE singleton = 1`,
    )
    .get() as DraftMetadataRow | undefined;
  if (row === undefined) throw new Error();
  return row;
}

function assertSession(
  metadata: DraftMetadataRow,
  session: AppendNovelDraftOperationInput<unknown>["session"],
): void {
  if (
    metadata.draft_session_id !== session.id ||
    metadata.novel_id !== session.novelId ||
    metadata.owner_conversation_id !== session.ownerConversationId ||
    metadata.base_revision !== session.baseRevision
  ) {
    throw new NovelInvariantViolationError(
      NOVEL_INVARIANT_FAILURE.persistenceInvariant,
      session.novelId,
      session.id,
    );
  }
}

function isSafeOperationError(error: unknown): boolean {
  return (
    error instanceof NovelOperationIdentityConflictError ||
    error instanceof NovelInvariantViolationError ||
    error instanceof NovelOperationHandlerNotFoundError ||
    error instanceof NovelOperationSynchronousHandlerError ||
    error instanceof NovelProtocolValidationError
  );
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
