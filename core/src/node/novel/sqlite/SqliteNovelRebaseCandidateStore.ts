/** Persists fully replayed Rebase Candidate identities in canonical SQLite. */
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NovelRebaseCandidateIdentityConflictError,
  captureNovelConversationId,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRebaseCandidate,
  captureNovelRevision,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type NovelDraftSessionId,
  type NovelId,
  type NovelRebaseCandidate,
  type NovelRebaseCandidateStore,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import { insertNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";

interface RebaseCandidateRow {
  candidate_draft_session_id: string;
  novel_id: string;
  source_draft_session_id: string;
  owner_conversation_id: string;
  source_base_revision: string;
  candidate_base_revision: string;
  operation_count: number;
  last_operation_sequence: number;
  prepared_at: string;
}

export interface SqliteNovelRebaseCandidateStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelRebaseCandidateStore
  implements NovelRebaseCandidateStore
{
  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    private readonly novelId: NovelId,
    private readonly workspaceId: string,
    private readonly logger: Logger,
  ) {}

  static async open(
    options: SqliteNovelRebaseCandidateStoreOptions,
  ): Promise<SqliteNovelRebaseCandidateStore> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const novelId = captureNovelId(options.novelId);
    const logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_rebase_candidate_store",
      workspaceId,
      novelId,
    });
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.location.canonicalDatabasePath);
      configure(database);
      assertStoreIdentity(database, workspaceId, novelId);
      logger.info("novel_rebase_candidate_store.open.completed");
      return new SqliteNovelRebaseCandidateStore(
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

  async createCandidate(candidateInput: NovelRebaseCandidate): Promise<void> {
    this.assertOpen();
    const candidate = captureNovelRebaseCandidate(candidateInput);
    this.assertIdentity(candidate.session.novelId);
    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database
        .prepare(
          `INSERT INTO novel_rebase_candidates(
             candidate_draft_session_id, novel_id, source_draft_session_id,
             owner_conversation_id, source_base_revision,
             candidate_base_revision, operation_count,
             last_operation_sequence, prepared_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.session.id,
          candidate.session.novelId,
          candidate.sourceDraftSessionId,
          candidate.session.ownerConversationId,
          candidate.sourceBaseRevision,
          candidate.session.baseRevision,
          candidate.operationCount,
          candidate.lastOperationSequence,
          candidate.preparedAt,
        );
      insertNovelLifecycleOutboxRecord(this.database, {
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `rebase-prepared:${candidate.session.id}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.rebasePrepared,
        novelId: candidate.session.novelId,
        conversationId: candidate.session.ownerConversationId,
        occurredAt: candidate.preparedAt,
        payload: {
          sourceDraftSessionId: candidate.sourceDraftSessionId,
          candidateDraftSessionId: candidate.session.id,
          sourceBaseRevision: candidate.sourceBaseRevision,
          candidateBaseRevision: candidate.session.baseRevision,
          operationCount: candidate.operationCount,
        },
      });
      this.database.exec("COMMIT");
      this.logger.info("novel_rebase_candidate_store.created", {
        sourceDraftSessionId: candidate.sourceDraftSessionId,
        candidateDraftSessionId: candidate.session.id,
        operationCount: candidate.operationCount,
      });
    } catch {
      try { this.database.exec("ROLLBACK"); } catch {}
      const existing = this.findConflict(candidate);
      if (existing !== undefined) {
        throw new NovelRebaseCandidateIdentityConflictError(
          candidate.sourceDraftSessionId,
          existing.candidateDraftSessionId,
        );
      }
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        this.workspaceId,
        this.novelId,
      );
    }
  }

  async getCandidate(
    novelId: NovelId,
    candidateDraftSessionId: NovelDraftSessionId,
  ): Promise<NovelRebaseCandidate | undefined> {
    this.assertIdentity(novelId);
    const row = this.database
      .prepare(
        `${REBASE_CANDIDATE_SELECT}
         WHERE novel_id = ? AND candidate_draft_session_id = ?`,
      )
      .get(
        this.novelId,
        captureNovelDraftSessionId(candidateDraftSessionId),
      ) as RebaseCandidateRow | undefined;
    return row === undefined ? undefined : captureRow(row);
  }

  async listCandidates(
    novelId: NovelId,
  ): Promise<readonly NovelRebaseCandidate[]> {
    this.assertIdentity(novelId);
    const rows = this.database
      .prepare(
        `${REBASE_CANDIDATE_SELECT}
         WHERE novel_id = ?
         ORDER BY prepared_at, candidate_draft_session_id`,
      )
      .all(this.novelId) as unknown as RebaseCandidateRow[];
    return Object.freeze(rows.map(captureRow));
  }

  async removeCandidate(
    novelId: NovelId,
    candidateDraftSessionId: NovelDraftSessionId,
  ): Promise<void> {
    this.assertIdentity(novelId);
    this.database
      .prepare(
        `DELETE FROM novel_rebase_candidates
         WHERE novel_id = ? AND candidate_draft_session_id = ?`,
      )
      .run(
        this.novelId,
        captureNovelDraftSessionId(candidateDraftSessionId),
      );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
    this.logger.info("novel_rebase_candidate_store.close.completed");
  }

  private findConflict(candidate: NovelRebaseCandidate):
    | { readonly candidateDraftSessionId: NovelDraftSessionId }
    | undefined {
    const row = this.database
      .prepare(
        `SELECT candidate_draft_session_id
         FROM novel_rebase_candidates
         WHERE candidate_draft_session_id = ? OR source_draft_session_id = ?
         LIMIT 1`,
      )
      .get(candidate.session.id, candidate.sourceDraftSessionId) as
      | { candidate_draft_session_id: string }
      | undefined;
    return row === undefined
      ? undefined
      : {
          candidateDraftSessionId: captureNovelDraftSessionId(
            row.candidate_draft_session_id,
          ),
        };
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

const REBASE_CANDIDATE_SELECT = `
  SELECT candidate_draft_session_id, novel_id, source_draft_session_id,
         owner_conversation_id, source_base_revision,
         candidate_base_revision, operation_count,
         last_operation_sequence, prepared_at
  FROM novel_rebase_candidates`;

function captureRow(row: RebaseCandidateRow): NovelRebaseCandidate {
  const preparedAt = captureNovelTimestamp(row.prepared_at);
  return captureNovelRebaseCandidate({
    sourceDraftSessionId: captureNovelDraftSessionId(
      row.source_draft_session_id,
    ),
    sourceBaseRevision: captureNovelRevision(row.source_base_revision),
    session: captureNovelDraftSession({
      id: captureNovelDraftSessionId(row.candidate_draft_session_id),
      novelId: captureNovelId(row.novel_id),
      ownerConversationId: captureNovelConversationId(
        row.owner_conversation_id,
      ),
      baseRevision: captureNovelRevision(row.candidate_base_revision),
      status: "rebasing",
      createdAt: preparedAt,
      updatedAt: preparedAt,
    }),
    operationCount: row.operation_count,
    lastOperationSequence: row.last_operation_sequence,
    preparedAt,
  });
}

function assertStoreIdentity(
  database: DatabaseSync,
  workspaceId: string,
  novelId: NovelId,
): void {
  const row = database
    .prepare(
      `SELECT novel_id, workspace_id
       FROM novel_metadata
       WHERE singleton = 1`,
    )
    .get() as { novel_id: string; workspace_id: string } | undefined;
  if (row === undefined) {
    throw new NovelDatabaseError(
      NOVEL_DATABASE_FAILURE.invalidStructure,
      workspaceId,
      novelId,
    );
  }
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
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
