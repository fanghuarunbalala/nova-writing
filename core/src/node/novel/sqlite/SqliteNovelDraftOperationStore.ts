/** Executes one Handler and Draft Journal append in one short SQLite transaction. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NOVEL_INVARIANT_FAILURE,
  NovelDraftOperationPersistenceError,
  NovelDraftChangeSetChangedError,
  NovelDraftChangeSetFrozenError,
  NovelInvariantViolationError,
  NovelOperationHandlerNotFoundError,
  NovelOperationIdentityConflictError,
  NovelOperationPreconditionError,
  NovelOperationSynchronousHandlerError,
  NovelProtocolValidationError,
  canonicalizeNovelOperation,
  captureNovelDraftSession,
  captureNovelId,
  captureNovelOperation,
  captureNovelOperationDigest,
  captureNovelChangeSetDigest,
  captureNovelTimestamp,
  type AppendNovelDraftOperationInput,
  type NovelDraftOperationReceipt,
  type NovelDraftOperationStore,
  type NovelDraftChangeSetStore,
  type NovelDraftOperationSequence,
  type FreezeNovelDraftChangeSetInput,
  type NovelId,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { digestNovelSha256Text } from "./NodeSha256NovelOperationDigester.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";
import { encodeNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";

interface DraftMetadataRow {
  draft_session_id: string;
  novel_id: string;
  owner_conversation_id: string;
  base_revision: string;
  operation_count: number;
  last_operation_sequence: number;
  change_set_state: "open" | "frozen";
  change_set_digest: string | null;
  change_set_frozen_at: string | null;
}

interface ExistingOperationRow {
  sequence: number;
  operation_digest: string;
}

interface DraftOperationRow {
  sequence: number;
  operation_json: string;
  operation_digest: string;
}

export interface SqliteNovelDraftOperationStoreOptions<TContext> {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly contextFactory: (database: DatabaseSync) => TContext;
  readonly logger?: Logger;
}

export class SqliteNovelDraftOperationStore<TContext>
  implements NovelDraftOperationStore<TContext>, NovelDraftChangeSetStore
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
      const databasePath = this.databasePath(session);
      initializeNovelDraftSqliteSchema(databasePath, session);
      database = new DatabaseSync(databasePath);
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
      if (metadata.change_set_state !== "open") {
        throw new NovelDraftChangeSetFrozenError(session.id);
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

      const outbox = encodeNovelLifecycleOutboxRecord({
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `draft-operation:${operation.operationId}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.draftOperationApplied,
        novelId: session.novelId,
        conversationId: session.ownerConversationId,
        occurredAt: recordedAt,
        payload: {
          draftSessionId: session.id,
          operationId: operation.operationId,
          operationType: operation.type,
          operationVersion: operation.operationVersion,
          sequence,
        },
      });
      database
        .prepare(
          `INSERT INTO draft_outbox(
             event_id, operation_sequence, operation_id, event_type,
             event_json, event_digest, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          outbox.eventId,
          sequence,
          operation.operationId,
          outbox.eventType,
          outbox.eventJson,
          outbox.eventDigest,
          outbox.createdAt,
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

  async readOperationSequence(
    inputSession: AppendNovelDraftOperationInput<TContext>["session"],
  ): Promise<NovelDraftOperationSequence> {
    const session = captureNovelDraftSession(inputSession);
    const databasePath = this.databasePath(session);
    initializeNovelDraftSqliteSchema(databasePath, session);
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      configureRead(database);
      const metadata = readMetadata(database);
      assertSession(metadata, session);
      const operations = readOperationSequence(database, metadata, session);
      const frozen = captureFrozenMetadata(metadata, session);
      return Object.freeze({
        operationCount: metadata.operation_count,
        lastOperationSequence: metadata.last_operation_sequence,
        operations,
        ...(frozen === undefined ? {} : { frozen }),
      });
    } catch (error) {
      if (error instanceof NovelInvariantViolationError) throw error;
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
      );
    } finally {
      try {
        database?.close();
      } catch {}
    }
  }

  async freezeChangeSet(input: FreezeNovelDraftChangeSetInput): Promise<{
    readonly digest: ReturnType<typeof captureNovelChangeSetDigest>;
    readonly frozenAt: ReturnType<typeof captureNovelTimestamp>;
  }> {
    const session = captureNovelDraftSession(input.session);
    const digest = captureNovelChangeSetDigest(input.digest);
    const frozenAt = captureNovelTimestamp(input.frozenAt);
    const expectedCount = captureNonNegativeCount(input.expectedOperationCount);
    const expectedSequence = captureNonNegativeCount(
      input.expectedLastOperationSequence,
    );
    const databasePath = this.databasePath(session);
    initializeNovelDraftSqliteSchema(databasePath, session);
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(databasePath);
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const metadata = readMetadata(database);
      assertSession(metadata, session);
      if (metadata.change_set_state === "frozen") {
        const existing = captureFrozenMetadata(metadata, session);
        if (
          existing === undefined ||
          existing.digest !== digest ||
          metadata.operation_count !== expectedCount ||
          metadata.last_operation_sequence !== expectedSequence
        ) {
          throw new NovelDraftChangeSetFrozenError(session.id);
        }
        database.exec("COMMIT");
        transactionStarted = false;
        return existing;
      }
      const result = database
        .prepare(
          `UPDATE draft_metadata
           SET change_set_state = 'frozen', change_set_digest = ?,
               change_set_frozen_at = ?, updated_at = ?
           WHERE singleton = 1 AND change_set_state = 'open'
             AND operation_count = ? AND last_operation_sequence = ?`,
        )
        .run(digest, frozenAt, frozenAt, expectedCount, expectedSequence);
      if (Number(result.changes) !== 1) {
        throw new NovelDraftChangeSetChangedError(session.id);
      }
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.info("novel_change_set.transaction.frozen", {
        novelId: session.novelId,
        draftSessionId: session.id,
        operationCount: expectedCount,
        lastOperationSequence: expectedSequence,
      });
      return Object.freeze({ digest, frozenAt });
    } catch (error) {
      if (transactionStarted) {
        try {
          database?.exec("ROLLBACK");
        } catch {}
      }
      if (
        error instanceof NovelDraftChangeSetFrozenError ||
        error instanceof NovelDraftChangeSetChangedError ||
        error instanceof NovelInvariantViolationError
      ) {
        throw error;
      }
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
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
              base_revision, operation_count, last_operation_sequence,
              change_set_state, change_set_digest, change_set_frozen_at
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
    error instanceof NovelDraftChangeSetFrozenError ||
    error instanceof NovelOperationIdentityConflictError ||
    error instanceof NovelOperationPreconditionError ||
    error instanceof NovelInvariantViolationError ||
    error instanceof NovelOperationHandlerNotFoundError ||
    error instanceof NovelOperationSynchronousHandlerError ||
    error instanceof NovelProtocolValidationError
  );
}

function readOperationSequence(
  database: DatabaseSync,
  metadata: DraftMetadataRow,
  session: AppendNovelDraftOperationInput<unknown>["session"],
): NovelDraftOperationSequence["operations"] {
  const rows = database
    .prepare(
      `SELECT sequence, operation_json, operation_digest
       FROM draft_operations ORDER BY sequence`,
    )
    .all() as unknown as DraftOperationRow[];
  if (
    rows.length !== metadata.operation_count ||
    (rows.at(-1)?.sequence ?? 0) !== metadata.last_operation_sequence
  ) {
    throw new NovelInvariantViolationError(
      NOVEL_INVARIANT_FAILURE.persistenceInvariant,
      session.novelId,
      session.id,
    );
  }
  return Object.freeze(rows.map((row, index) => {
    if (row.sequence !== index + 1) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
      );
    }
    const operation = captureNovelOperation(
      JSON.parse(row.operation_json) as ReturnType<typeof captureNovelOperation>,
    );
    const operationDigest = captureNovelOperationDigest(row.operation_digest);
    if (
      canonicalizeNovelOperation(operation) !== row.operation_json ||
      digestNovelSha256Text(row.operation_json) !== operationDigest
    ) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
      );
    }
    return Object.freeze({ sequence: row.sequence, operation, operationDigest });
  }));
}

function captureFrozenMetadata(
  metadata: DraftMetadataRow,
  session: AppendNovelDraftOperationInput<unknown>["session"],
): NovelDraftOperationSequence["frozen"] {
  if (metadata.change_set_state === "open") {
    if (metadata.change_set_digest !== null || metadata.change_set_frozen_at !== null) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
      );
    }
    return undefined;
  }
  if (metadata.change_set_digest === null || metadata.change_set_frozen_at === null) {
    throw new NovelInvariantViolationError(
      NOVEL_INVARIANT_FAILURE.persistenceInvariant,
      session.novelId,
      session.id,
    );
  }
  return Object.freeze({
    digest: captureNovelChangeSetDigest(metadata.change_set_digest),
    frozenAt: captureNovelTimestamp(metadata.change_set_frozen_at),
  });
}

function captureNonNegativeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return value as number;
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function configureRead(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
