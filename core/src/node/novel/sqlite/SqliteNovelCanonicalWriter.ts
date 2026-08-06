/**
 * 在 canonical 库上以单个自动短事务执行一次 domain operation 并推进 revision。
 * 乐观锁由调用方传入 baseRevision，事务内与 current_revision 比对。
 * Executes one domain operation on the canonical database in a single
 * automatic short transaction and advances the revision. The optimistic lock
 * compares the caller-provided baseRevision with current_revision in-transaction.
 */
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NovelInvariantViolationError,
  NovelOperationHandlerNotFoundError,
  NovelOperationPreconditionError,
  NovelOperationSynchronousHandlerError,
  NovelProtocolValidationError,
  NovelRevisionConflictError,
  RandomNovelRevisionFactory,
  SystemNovelClock,
  captureNovelConversationId,
  captureNovelId,
  captureNovelOperation,
  captureNovelRevision,
  type NovelClock,
  type NovelId,
  type NovelMutationContext,
  type NovelOperation,
  type NovelOperationExecutor,
  type NovelOperationId,
  type NovelRevision,
  type NovelRevisionFactory,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import { insertNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";
import { createSqliteNovelMutationContext } from "./SqliteNovelOutlineRepository.js";

export interface SqliteNovelCanonicalWriterOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly executor: NovelOperationExecutor<NovelMutationContext>;
  readonly revisionFactory?: NovelRevisionFactory;
  readonly clock?: NovelClock;
  readonly logger?: Logger;
}

export interface ApplyNovelCanonicalOperationInput {
  readonly operation: NovelOperation;
  readonly conversationId: string;
  readonly baseRevision?: NovelRevision;
}

export interface ApplyNovelCanonicalOperationResult {
  readonly status: "applied";
  readonly operationId: NovelOperationId;
  readonly baseRevision: NovelRevision;
  readonly resultRevision: NovelRevision;
}

export class SqliteNovelCanonicalWriter {
  readonly #location: NodeNovelStoreLocation;
  readonly #novelId: NovelId;
  readonly #executor: NovelOperationExecutor<NovelMutationContext>;
  readonly #revisionFactory: NovelRevisionFactory;
  readonly #clock: NovelClock;
  readonly #logger: Logger;

  constructor(options: SqliteNovelCanonicalWriterOptions) {
    this.#location = options.location;
    this.#novelId = captureNovelId(options.novelId);
    this.#executor = options.executor;
    this.#revisionFactory =
      options.revisionFactory ?? new RandomNovelRevisionFactory();
    this.#clock = options.clock ?? new SystemNovelClock();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_canonical_writer",
      workspaceId: options.location.workspaceId,
      novelId: this.#novelId,
    });
  }

  /** 应用一次 canonical 写操作（单个自动短事务）。Applies one canonical write in one short transaction. */
  async applyOperation(
    input: ApplyNovelCanonicalOperationInput,
  ): Promise<ApplyNovelCanonicalOperationResult> {
    const capturedOperation = captureNovelOperation(input.operation);
    const conversationId = captureNovelConversationId(input.conversationId);
    const baseRevision =
      input.baseRevision === undefined
        ? undefined
        : captureNovelRevision(input.baseRevision);
    this.#logger.info("novel_canonical_write.transaction.started", {
      novelId: this.#novelId,
      operationId: capturedOperation.operationId,
      operationType: capturedOperation.type,
      operationVersion: capturedOperation.operationVersion,
    });
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(this.#location.canonicalDatabasePath);
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const metadata = database
        .prepare(
          "SELECT novel_id, current_revision FROM novel_metadata WHERE singleton = 1",
        )
        .get() as
        | { novel_id: string; current_revision: string }
        | undefined;
      if (metadata?.novel_id !== this.#novelId) {
        throw invariant(this.#novelId);
      }
      const actualRevision = captureNovelRevision(metadata.current_revision);
      if (baseRevision !== undefined && baseRevision !== actualRevision) {
        throw new NovelRevisionConflictError(
          this.#novelId,
          baseRevision,
          actualRevision,
        );
      }
      const resultRevision = this.#revisionFactory.createRevision();
      this.#executor.executeSynchronous(
        createSqliteNovelMutationContext(database),
        capturedOperation,
      );
      const occurredAt = this.#clock.now();
      const update = database
        .prepare(
          `UPDATE novel_metadata SET current_revision = ?, updated_at = ?
           WHERE singleton = 1 AND novel_id = ? AND current_revision = ?`,
        )
        .run(resultRevision, occurredAt, this.#novelId, actualRevision);
      if (Number(update.changes) !== 1) throw invariant(this.#novelId);
      insertNovelLifecycleOutboxRecord(database, {
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `canonical-write:${resultRevision}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.canonicalWriteApplied,
        novelId: this.#novelId,
        conversationId,
        occurredAt,
        payload: {
          operationId: capturedOperation.operationId,
          operationType: capturedOperation.type,
          operationVersion: capturedOperation.operationVersion,
          baseRevision: actualRevision,
          resultRevision,
        },
      });
      database.exec("COMMIT");
      transactionStarted = false;
      this.#logger.info("novel_canonical_write.transaction.completed", {
        novelId: this.#novelId,
        operationId: capturedOperation.operationId,
        resultRevision,
      });
      return Object.freeze({
        status: "applied",
        operationId: capturedOperation.operationId,
        baseRevision: actualRevision,
        resultRevision,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          database?.exec("ROLLBACK");
        } catch {}
      }
      // 只记录稳定失败类型；不记录原始消息/堆栈/cause（脱敏）。
      this.#logger.info("novel_canonical_write.transaction.failed", {
        novelId: this.#novelId,
        operationId: capturedOperation.operationId,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(error instanceof Error && "code" in error
          ? { errorCode: String((error as { code: unknown }).code) }
          : {}),
      });
      if (isSafeCanonicalWriteError(error)) throw error;
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        this.#location.workspaceId,
        this.#novelId,
      );
    } finally {
      try {
        database?.close();
      } catch {}
    }
  }
}

function invariant(novelId: NovelId): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    novelId,
  );
}

function isSafeCanonicalWriteError(error: unknown): boolean {
  return (
    error instanceof NovelRevisionConflictError ||
    error instanceof NovelOperationPreconditionError ||
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
