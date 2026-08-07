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
  type NovelOperation,
  type NovelOperationExecutor,
  type NovelOperationId,
  type NovelRevision,
  type NovelRevisionFactory,
} from "../../../novel/index.js";
import type {
  NovelCanonicalWriteInput,
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../../../novel/port/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import { insertNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";

export interface SqliteNovelCanonicalWriterOptions<TContext> {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly executor: NovelOperationExecutor<TContext>;
  readonly contextFactory: (database: DatabaseSync) => TContext;
  readonly revisionFactory?: NovelRevisionFactory;
  readonly clock?: NovelClock;
  readonly logger?: Logger;
}

export interface ApplyNovelCanonicalOperationInput {
  readonly operation: NovelOperation;
  readonly conversationId: string;
  readonly baseRevision: NovelRevision;
}

export interface ApplyNovelCanonicalOperationResult {
  readonly status: "applied";
  readonly operationId: NovelOperationId;
  readonly baseRevision: NovelRevision;
  readonly resultRevision: NovelRevision;
}

export class SqliteNovelCanonicalWriter<TContext>
  implements NovelCanonicalWritePort
{
  readonly #location: NodeNovelStoreLocation;
  readonly #novelId: NovelId;
  readonly #executor: NovelOperationExecutor<TContext>;
  readonly #contextFactory: (database: DatabaseSync) => TContext;
  readonly #revisionFactory: NovelRevisionFactory;
  readonly #clock: NovelClock;
  readonly #logger: Logger;

  constructor(options: SqliteNovelCanonicalWriterOptions<TContext>) {
    this.#location = options.location;
    this.#novelId = captureNovelId(options.novelId);
    this.#executor = options.executor;
    this.#contextFactory = options.contextFactory;
    this.#revisionFactory =
      options.revisionFactory ?? new RandomNovelRevisionFactory();
    this.#clock = options.clock ?? new SystemNovelClock();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_canonical_writer",
      workspaceId: options.location.workspaceId,
      novelId: this.#novelId,
    });
  }

  /** 应用一次 canonical 写操作（委托批量事务）。Applies one canonical write via the batch transaction. */
  async applyOperation(
    input: ApplyNovelCanonicalOperationInput,
  ): Promise<ApplyNovelCanonicalOperationResult> {
    const result = await this.applyOperations({
      operations: [input.operation],
      conversationId: input.conversationId,
      baseRevision: input.baseRevision,
    });
    return Object.freeze({
      status: "applied",
      operationId: result.operationIds[0],
      baseRevision: result.baseRevision,
      resultRevision: result.resultRevision,
    });
  }

  /** 批量应用 canonical 写操作（一个自动短事务，任一失败整批回滚）。Applies a batch in one short transaction, rolling back on any failure. */
  async applyOperations(
    input: NovelCanonicalWriteInput,
  ): Promise<NovelCanonicalWriteResult> {
    const capturedOperations = input.operations.map(captureNovelOperation);
    const conversationId = captureNovelConversationId(input.conversationId);
    const baseRevision = captureNovelRevision(input.baseRevision);
    this.#logger.info("novel_canonical_write.transaction.started", {
      novelId: this.#novelId,
      operationCount: capturedOperations.length,
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
      if (baseRevision !== actualRevision) {
        throw new NovelRevisionConflictError(
          this.#novelId,
          baseRevision,
          actualRevision,
        );
      }
      const resultRevision = this.#revisionFactory.createRevision();
      const context = this.#contextFactory(database);
      for (const operation of capturedOperations) {
        this.#executor.executeSynchronous(context, operation);
      }
      const occurredAt = this.#clock.now();
      const update = database
        .prepare(
          `UPDATE novel_metadata SET current_revision = ?, updated_at = ?
           WHERE singleton = 1 AND novel_id = ? AND current_revision = ?`,
        )
        .run(resultRevision, occurredAt, this.#novelId, actualRevision);
      if (Number(update.changes) !== 1) throw invariant(this.#novelId);
      const openDatabase = database;
      capturedOperations.forEach((operation, index) => {
        insertNovelLifecycleOutboxRecord(openDatabase, {
          recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
          eventId: `canonical-write:${resultRevision}:${index}`,
          eventType: NOVEL_LIFECYCLE_EVENT_TYPE.canonicalWriteApplied,
          novelId: this.#novelId,
          conversationId,
          occurredAt,
          payload: {
            operationId: operation.operationId,
            operationType: operation.type,
            operationVersion: operation.operationVersion,
            baseRevision: actualRevision,
            resultRevision,
          },
        });
      });
      database.exec("COMMIT");
      transactionStarted = false;
      this.#logger.info("novel_canonical_write.transaction.completed", {
        novelId: this.#novelId,
        operationCount: capturedOperations.length,
        resultRevision,
      });
      return Object.freeze({
        status: "applied",
        operationIds: capturedOperations.map(
          (operation) => operation.operationId,
        ),
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
        operationCount: capturedOperations.length,
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

  /** 读取当前 canonical revision（乐观锁载体）。Reads the current canonical revision. */
  async getCurrentRevision(): Promise<NovelRevision> {
    const database = new DatabaseSync(
      this.#location.canonicalDatabasePath,
      { readOnly: true },
    );
    try {
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
      return captureNovelRevision(metadata.current_revision);
    } finally {
      database.close();
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
