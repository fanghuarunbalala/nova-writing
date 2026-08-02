/** Persists Draft Session lifecycle records in the canonical Novel database. */
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NovelDraftAlreadyActiveError,
  NovelDraftSessionNotFoundError,
  NovelDraftSessionStateError,
  NovelRevisionConflictError,
  captureNovelDraftSession,
  captureNovelDraftSessionStatus,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type NovelDraftSession,
  type NovelDraftSessionId,
  type NovelDraftSessionStatus,
  type NovelDraftStore,
  type NovelId,
  type ResetNovelDraftRecordInput,
  type RollbackNovelDraftRecordInput,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";

interface NovelDraftSessionRow {
  id: string;
  novel_id: string;
  owner_conversation_id: string;
  base_revision: string;
  status: string;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
}

export interface SqliteNovelDraftStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelDraftStore implements NovelDraftStore {
  private closed = false;
  private closePromise?: Promise<void>;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly novelId: NovelId,
    private readonly workspaceId: string,
    private readonly logger: Logger,
  ) {}

  static async open(
    options: SqliteNovelDraftStoreOptions,
  ): Promise<SqliteNovelDraftStore> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const novelId = captureNovelId(options.novelId);
    const logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_draft_store",
      workspaceId,
      novelId,
    });
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.location.canonicalDatabasePath);
      configureDatabase(database);
      assertStoreIdentity(database, workspaceId, novelId);
      logger.info("novel_draft_store.open.completed");
      return new SqliteNovelDraftStore(
        database,
        novelId,
        workspaceId,
        logger,
      );
    } catch (error) {
      try {
        database?.close();
      } catch {}
      if (error instanceof NovelDatabaseError) throw error;
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        workspaceId,
        novelId,
      );
    }
  }

  async createDraftSession(session: NovelDraftSession): Promise<void> {
    this.assertOpen();
    const captured = captureNovelDraftSession(session);
    if (
      captured.novelId !== this.novelId ||
      captured.status !== NOVEL_DRAFT_SESSION_STATUS.active
    ) {
      throw new NovelDraftSessionStateError(
        captured.id,
        [NOVEL_DRAFT_SESSION_STATUS.active],
        captured.status,
      );
    }
    const existing = await this.getActiveDraftSession(
      captured.novelId,
      captured.ownerConversationId,
    );
    if (existing !== undefined) {
      throw new NovelDraftAlreadyActiveError(
        this.novelId,
        captured.ownerConversationId,
        existing.id,
      );
    }
    try {
      this.database
        .prepare(
          `INSERT INTO novel_draft_sessions(
             id, novel_id, owner_conversation_id, base_revision, status,
             staging_key, created_at, updated_at, terminal_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          captured.id,
          captured.novelId,
          captured.ownerConversationId,
          captured.baseRevision,
          captured.status,
          captured.id,
          captured.createdAt,
          captured.updatedAt,
        );
    } catch {
      const concurrent = await this.getActiveDraftSession(
        captured.novelId,
        captured.ownerConversationId,
      );
      if (concurrent !== undefined) {
        throw new NovelDraftAlreadyActiveError(
          this.novelId,
          captured.ownerConversationId,
          concurrent.id,
        );
      }
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        this.workspaceId,
        this.novelId,
      );
    }
    this.logger.info("novel_draft_store.created", {
      draftSessionId: captured.id,
      ownerConversationId: captured.ownerConversationId,
    });
  }

  async getDraftSession(
    novelId: NovelId,
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSession | undefined> {
    this.assertIdentity(novelId);
    const row = this.database
      .prepare(
        `${DRAFT_SESSION_SELECT}
         WHERE novel_id = ? AND id = ?`,
      )
      .get(this.novelId, draftSessionId) as NovelDraftSessionRow | undefined;
    return row === undefined ? undefined : captureDraftRow(row);
  }

  async getActiveDraftSession(
    novelId: NovelId,
    ownerConversationId: string,
  ): Promise<NovelDraftSession | undefined> {
    this.assertIdentity(novelId);
    const row = this.database
      .prepare(
        `${DRAFT_SESSION_SELECT}
         WHERE novel_id = ? AND owner_conversation_id = ?
           AND status NOT IN ('committed', 'rolled-back')
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(this.novelId, ownerConversationId) as
      | NovelDraftSessionRow
      | undefined;
    return row === undefined ? undefined : captureDraftRow(row);
  }

  async listDraftSessions(
    novelId: NovelId,
  ): Promise<readonly NovelDraftSession[]> {
    this.assertIdentity(novelId);
    const rows = this.database
      .prepare(
        `${DRAFT_SESSION_SELECT}
         WHERE novel_id = ?
         ORDER BY created_at, id`,
      )
      .all(this.novelId) as unknown as NovelDraftSessionRow[];
    return Object.freeze(rows.map(captureDraftRow));
  }

  async resetDraftSession(
    input: ResetNovelDraftRecordInput,
  ): Promise<NovelDraftSession> {
    this.assertIdentity(input.novelId);
    const statuses = captureExpectedStatuses(input.expectedStatuses);
    const placeholders = statuses.map(() => "?").join(", ");
    const result = this.database
      .prepare(
        `UPDATE novel_draft_sessions
         SET base_revision = ?, updated_at = ?, terminal_at = NULL
         WHERE novel_id = ? AND id = ? AND base_revision = ?
           AND status IN (${placeholders})`,
      )
      .run(
        captureNovelRevision(input.baseRevision),
        captureNovelTimestamp(input.resetAt),
        this.novelId,
        input.draftSessionId,
        captureNovelRevision(input.expectedBaseRevision),
        ...statuses,
      );
    if (Number(result.changes) !== 1) {
      this.throwTransitionFailure(
        input.draftSessionId,
        input.expectedBaseRevision,
        statuses,
      );
    }
    return this.requireDraftSession(input.draftSessionId);
  }

  async rollbackDraftSession(
    input: RollbackNovelDraftRecordInput,
  ): Promise<NovelDraftSession> {
    this.assertIdentity(input.novelId);
    const statuses = captureExpectedStatuses(input.expectedStatuses);
    const rolledBackAt = captureNovelTimestamp(input.rolledBackAt);
    const placeholders = statuses.map(() => "?").join(", ");
    const result = this.database
      .prepare(
        `UPDATE novel_draft_sessions
         SET status = 'rolled-back', updated_at = ?, terminal_at = ?
         WHERE novel_id = ? AND id = ? AND status IN (${placeholders})`,
      )
      .run(
        rolledBackAt,
        rolledBackAt,
        this.novelId,
        input.draftSessionId,
        ...statuses,
      );
    if (Number(result.changes) !== 1) {
      this.throwTransitionFailure(input.draftSessionId, undefined, statuses);
    }
    return this.requireDraftSession(input.draftSessionId);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
    this.logger.info("novel_draft_store.close.completed");
  }

  private requireDraftSession(
    draftSessionId: NovelDraftSessionId,
  ): NovelDraftSession {
    const row = this.database
      .prepare(`${DRAFT_SESSION_SELECT} WHERE novel_id = ? AND id = ?`)
      .get(this.novelId, draftSessionId) as NovelDraftSessionRow | undefined;
    if (row === undefined) throw new NovelDraftSessionNotFoundError(draftSessionId);
    return captureDraftRow(row);
  }

  private throwTransitionFailure(
    draftSessionId: NovelDraftSessionId,
    expectedBaseRevision: ResetNovelDraftRecordInput["expectedBaseRevision"] | undefined,
    expectedStatuses: readonly NovelDraftSessionStatus[],
  ): never {
    const current = this.requireDraftSession(draftSessionId);
    if (
      expectedBaseRevision !== undefined &&
      current.baseRevision !== expectedBaseRevision
    ) {
      throw new NovelRevisionConflictError(
        this.novelId,
        expectedBaseRevision,
        current.baseRevision,
        draftSessionId,
      );
    }
    throw new NovelDraftSessionStateError(
      draftSessionId,
      expectedStatuses,
      current.status,
    );
  }

  private assertIdentity(novelId: NovelId): void {
    this.assertOpen();
    if (captureNovelId(novelId) !== this.novelId) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.novelMismatch,
        this.workspaceId,
        this.novelId,
      );
    }
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

const DRAFT_SESSION_SELECT = `
  SELECT id, novel_id, owner_conversation_id, base_revision, status,
         created_at, updated_at, terminal_at
  FROM novel_draft_sessions`;

function captureDraftRow(row: NovelDraftSessionRow): NovelDraftSession {
  return captureNovelDraftSession({
    id: row.id as NovelDraftSessionId,
    novelId: row.novel_id as NovelId,
    ownerConversationId: row.owner_conversation_id,
    baseRevision: captureNovelRevision(row.base_revision),
    status: captureNovelDraftSessionStatus(row.status),
    createdAt: captureNovelTimestamp(row.created_at),
    updatedAt: captureNovelTimestamp(row.updated_at),
    ...(row.terminal_at === null
      ? {}
      : { terminalAt: captureNovelTimestamp(row.terminal_at) }),
  });
}

function captureExpectedStatuses(
  statuses: readonly NovelDraftSessionStatus[],
): readonly NovelDraftSessionStatus[] {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }
  const captured = statuses.map(captureNovelDraftSessionStatus);
  if (new Set(captured).size !== captured.length) {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }
  return Object.freeze(captured);
}

function assertStoreIdentity(
  database: DatabaseSync,
  workspaceId: string,
  novelId: NovelId,
): void {
  try {
    const row = database
      .prepare(
        `SELECT novel_id, workspace_id
         FROM novel_metadata
         WHERE singleton = 1`,
      )
      .get() as { novel_id: string; workspace_id: string } | undefined;
    if (row === undefined) throw new Error();
    if (captureNovelWorkspaceId(row.workspace_id) !== workspaceId) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.workspaceMismatch,
        workspaceId,
        novelId,
      );
    }
    if (captureNovelId(row.novel_id) !== novelId) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.novelMismatch,
        workspaceId,
        novelId,
      );
    }
  } catch (error) {
    if (error instanceof NovelDatabaseError) throw error;
    throw new NovelDatabaseError(
      NOVEL_DATABASE_FAILURE.invalidStructure,
      workspaceId,
      novelId,
    );
  }
}

function configureDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
