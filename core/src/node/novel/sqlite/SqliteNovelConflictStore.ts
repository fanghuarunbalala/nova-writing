/** Stores digest-only unresolved conflicts inside the candidate Draft DB. */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NovelInvariantViolationError,
  NOVEL_INVARIANT_FAILURE,
  canonicalizeNovelConflict,
  canonicalizeNovelConflictResolutionRecord,
  captureNovelConflict,
  captureNovelConflictDigest,
  captureNovelConflictRecord,
  captureNovelConflictResolutionRecord,
  captureNovelDraftSession,
  type NovelConflictRecord,
  type NovelConflictDigest,
  type NovelConflictResolutionRecord,
  type NovelConflictStore,
  type NovelDraftSession,
  type NovelId,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { digestNovelConflictText } from "./NodeSha256NovelConflictDigester.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";
import { insertDraftNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";

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
      insertDraftNovelLifecycleOutboxRecord(database, {
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `conflict-detected:${record.conflict.id}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.conflictDetected,
        novelId: session.novelId,
        conversationId: session.ownerConversationId,
        occurredAt: record.conflict.createdAt,
        payload: {
          draftSessionId: session.id,
          conflictId: record.conflict.id,
          operationId: record.conflict.operationId,
          kind: record.conflict.kind,
        },
      });
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
    return this.readConflicts(sessionInput, true);
  }

  async listAllConflicts(
    sessionInput: NovelDraftSession,
  ): Promise<readonly NovelConflictRecord[]> {
    return this.readConflicts(sessionInput, false);
  }

  private async readConflicts(
    sessionInput: NovelDraftSession,
    unresolvedOnly: boolean,
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
           ${unresolvedOnly ? "WHERE status = 'unresolved'" : ""}
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

  async resolveConflict(
    sessionInput: NovelDraftSession,
    resolutionInput: NovelConflictResolutionRecord,
    digestInput: NovelConflictDigest,
  ): Promise<"resolved" | "duplicate"> {
    const session = captureNovelDraftSession(sessionInput);
    const resolution = captureNovelConflictResolutionRecord(resolutionInput);
    const digest = captureNovelConflictDigest(digestInput);
    if (
      resolution.draftSessionId !== session.id ||
      digestNovelConflictText(
        canonicalizeNovelConflictResolutionRecord(resolution),
      ) !== digest
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
      const row = database
        .prepare(
          `SELECT status, resolution_json, resolution_digest
           FROM draft_conflicts WHERE conflict_id = ?`,
        )
        .get(resolution.conflictId) as
        | {
            status: string;
            resolution_json: string | null;
            resolution_digest: string | null;
          }
        | undefined;
      if (row === undefined) throw corrupt(session);
      const json = canonicalizeNovelConflictResolutionRecord(resolution);
      if (row.status === "resolved") {
        if (
          row.resolution_json !== json ||
          row.resolution_digest !== digest
        ) {
          throw corrupt(session);
        }
        database.exec("COMMIT");
        transaction = false;
        return "duplicate";
      }
      if (
        row.status !== "unresolved" ||
        row.resolution_json !== null ||
        row.resolution_digest !== null
      ) {
        throw corrupt(session);
      }
      const result = database
        .prepare(
          `UPDATE draft_conflicts
           SET status = 'resolved', resolution_json = ?,
               resolution_digest = ?, resolved_at = ?
           WHERE conflict_id = ? AND status = 'unresolved'`,
        )
        .run(json, digest, resolution.resolvedAt, resolution.conflictId);
      if (Number(result.changes) !== 1) throw corrupt(session);
      insertDraftNovelLifecycleOutboxRecord(database, {
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `conflict-resolved:${resolution.conflictId}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.conflictResolved,
        novelId: session.novelId,
        conversationId: session.ownerConversationId,
        occurredAt: resolution.resolvedAt,
        payload: {
          draftSessionId: session.id,
          conflictId: resolution.conflictId,
          strategy: resolution.resolution.strategy,
        },
      });
      database.exec("COMMIT");
      transaction = false;
      this.logger.info("novel_conflict.resolved", {
        draftSessionId: session.id,
        conflictId: resolution.conflictId,
        resolutionStrategy: resolution.resolution.strategy,
      });
      return "resolved";
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

  async listResolutions(
    sessionInput: NovelDraftSession,
  ): Promise<readonly NovelConflictResolutionRecord[]> {
    const session = captureNovelDraftSession(sessionInput);
    initializeNovelDraftSqliteSchema(this.databasePath(session), session);
    const database = new DatabaseSync(this.databasePath(session), {
      readOnly: true,
    });
    try {
      const rows = database
        .prepare(
          `SELECT resolution_json, resolution_digest
           FROM draft_conflicts
           WHERE status = 'resolved'
           ORDER BY resolved_at, conflict_id`,
        )
        .all() as unknown as Array<{
          resolution_json: string;
          resolution_digest: string;
        }>;
      return Object.freeze(rows.map((row) => {
        const resolution = captureNovelConflictResolutionRecord(
          JSON.parse(row.resolution_json),
        );
        const digest = captureNovelConflictDigest(row.resolution_digest);
        if (
          canonicalizeNovelConflictResolutionRecord(resolution) !==
            row.resolution_json ||
          digestNovelConflictText(row.resolution_json) !== digest
        ) {
          throw corrupt(session);
        }
        return resolution;
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
