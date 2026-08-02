/** Stores digest-only unresolved conflicts inside the candidate Draft DB. */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  NovelInvariantViolationError,
  NOVEL_INVARIANT_FAILURE,
  canonicalizeNovelConflict,
  captureNovelConflict,
  captureNovelConflictDigest,
  captureNovelConflictRecord,
  captureNovelDraftSession,
  type NovelConflictRecord,
  type NovelConflictStore,
  type NovelDraftSession,
  type NovelId,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { digestNovelConflictText } from "./NodeSha256NovelConflictDigester.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";

export interface SqliteNovelConflictStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelConflictStore implements NovelConflictStore {
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelConflictStoreOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_conflict_store",
      workspaceId: options.location.workspaceId,
      novelId: options.novelId,
    });
  }

  async recordConflict(
    sessionInput: NovelDraftSession,
    recordInput: NovelConflictRecord,
  ): Promise<"recorded" | "duplicate"> {
    const session = captureNovelDraftSession(sessionInput);
    const record = captureNovelConflictRecord(recordInput);
    if (
      session.novelId !== this.options.novelId ||
      record.conflict.draftSessionId !== session.id ||
      digestNovelConflictText(canonicalizeNovelConflict(record.conflict)) !==
        record.digest
    ) {
      throw corrupt(session);
    }
    initializeNovelDraftSqliteSchema(this.databasePath(session), session);
    const database = new DatabaseSync(this.databasePath(session));
    let transaction = false;
    try {
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      transaction = true;
      const existing = database
        .prepare(
          `SELECT conflict_json, conflict_digest
           FROM draft_conflicts WHERE conflict_id = ?`,
        )
        .get(record.conflict.id) as
        | { conflict_json: string; conflict_digest: string }
        | undefined;
      const json = canonicalizeNovelConflict(record.conflict);
      if (existing !== undefined) {
        if (
          existing.conflict_json !== json ||
          existing.conflict_digest !== record.digest
        ) {
          throw corrupt(session);
        }
        database.exec("COMMIT");
        transaction = false;
        return "duplicate";
      }
      database
        .prepare(
          `INSERT INTO draft_conflicts(
             conflict_id, source_operation_id, status, conflict_json,
             conflict_digest, created_at, resolved_at
           ) VALUES (?, ?, 'unresolved', ?, ?, ?, NULL)`,
        )
        .run(
          record.conflict.id,
          record.conflict.operationId,
          json,
          record.digest,
          record.conflict.createdAt,
        );
      database.exec("COMMIT");
      transaction = false;
      this.logger.info("novel_conflict.recorded", {
        draftSessionId: session.id,
        conflictId: record.conflict.id,
        operationId: record.conflict.operationId,
        conflictKind: record.conflict.kind,
      });
      return "recorded";
    } catch (error) {
      if (transaction) {
        try { database.exec("ROLLBACK"); } catch {}
      }
      if (error instanceof NovelInvariantViolationError) throw error;
      throw corrupt(session);
    } finally {
      database.close();
    }
  }

  async listConflicts(
    sessionInput: NovelDraftSession,
  ): Promise<readonly NovelConflictRecord[]> {
    const session = captureNovelDraftSession(sessionInput);
    initializeNovelDraftSqliteSchema(this.databasePath(session), session);
    const database = new DatabaseSync(this.databasePath(session), {
      readOnly: true,
    });
    try {
      const rows = database
        .prepare(
          `SELECT conflict_json, conflict_digest
           FROM draft_conflicts
           WHERE status = 'unresolved'
           ORDER BY created_at, conflict_id`,
        )
        .all() as unknown as Array<{
          conflict_json: string;
          conflict_digest: string;
        }>;
      return Object.freeze(rows.map((row) => {
        const conflict = captureNovelConflict(
          JSON.parse(row.conflict_json),
        );
        const digest = captureNovelConflictDigest(row.conflict_digest);
        if (
          canonicalizeNovelConflict(conflict) !== row.conflict_json ||
          digestNovelConflictText(row.conflict_json) !== digest
        ) {
          throw corrupt(session);
        }
        return captureNovelConflictRecord({ conflict, digest });
      }));
    } finally {
      database.close();
    }
  }

  private databasePath(session: NovelDraftSession): string {
    return join(
      this.options.location.stagingDir,
      session.ownerConversationId,
      session.id,
      "draft.sqlite",
    );
  }
}

function corrupt(session: NovelDraftSession): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    session.novelId,
    session.id,
  );
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
