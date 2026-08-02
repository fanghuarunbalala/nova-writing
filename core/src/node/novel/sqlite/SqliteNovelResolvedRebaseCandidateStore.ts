/** Persists resolved sibling candidate identities in canonical SQLite. */
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NOVEL_LIFECYCLE_RECORD_VERSION,
  NovelRebaseCandidateIdentityConflictError,
  NOVEL_DRAFT_SESSION_STATUS,
  captureNovelConversationId,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelResolvedRebaseCandidate,
  captureNovelResolvedRebasePromotion,
  captureNovelRevision,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type NovelDraftSessionId,
  type NovelId,
  type NovelResolvedRebaseCandidate,
  type NovelResolvedRebasePromotionResult,
  type NovelResolvedRebaseCandidateStore,
  type NovelTimestamp,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { NOVEL_DATABASE_FAILURE, NovelDatabaseError } from "./NovelDatabaseErrors.js";
import { insertNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";

interface Row {
  resolved_candidate_draft_session_id: string;
  novel_id: string;
  source_draft_session_id: string;
  conflicted_candidate_draft_session_id: string;
  owner_conversation_id: string;
  candidate_base_revision: string;
  resolution_plan_digest: string;
  operation_count: number;
  last_operation_sequence: number;
  prepared_at: string;
  promoted_at: string | null;
}

export interface SqliteNovelResolvedRebaseCandidateStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelResolvedRebaseCandidateStore
  implements NovelResolvedRebaseCandidateStore {
  private closed = false;
  private constructor(
    private readonly database: DatabaseSync,
    private readonly novelId: NovelId,
    private readonly workspaceId: string,
    private readonly logger: Logger,
  ) {}

  static async open(
    options: SqliteNovelResolvedRebaseCandidateStoreOptions,
  ): Promise<SqliteNovelResolvedRebaseCandidateStore> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const novelId = captureNovelId(options.novelId);
    const database = new DatabaseSync(options.location.canonicalDatabasePath);
    try {
      configure(database);
      const row = database.prepare(
        "SELECT novel_id, workspace_id FROM novel_metadata WHERE singleton = 1",
      ).get() as { novel_id: string; workspace_id: string } | undefined;
      database.prepare("SELECT resolved_candidate_draft_session_id FROM novel_resolved_rebase_candidates LIMIT 0");
      if (row?.novel_id !== novelId || row.workspace_id !== workspaceId) throw new Error();
      return new SqliteNovelResolvedRebaseCandidateStore(
        database,
        novelId,
        workspaceId,
        (options.logger ?? noopLogger).child({
          component: "sqlite_novel_resolved_rebase_candidate_store",
          workspaceId,
          novelId,
        }),
      );
    } catch {
      try { database.close(); } catch {}
      throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure, workspaceId, novelId);
    }
  }

  async createResolvedCandidate(input: NovelResolvedRebaseCandidate): Promise<void> {
    this.assertOpen();
    const candidate = captureNovelResolvedRebaseCandidate(input);
    if (candidate.session.novelId !== this.novelId) throw invalid(this.workspaceId, this.novelId);
    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database.prepare(
        `INSERT INTO novel_resolved_rebase_candidates(
           resolved_candidate_draft_session_id, novel_id, source_draft_session_id,
           conflicted_candidate_draft_session_id, owner_conversation_id,
           candidate_base_revision, resolution_plan_digest, operation_count,
           last_operation_sequence, prepared_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        candidate.session.id, candidate.session.novelId,
        candidate.sourceDraftSessionId, candidate.conflictedCandidateDraftSessionId,
        candidate.session.ownerConversationId, candidate.session.baseRevision,
        candidate.resolutionPlanDigest, candidate.operationCount,
        candidate.lastOperationSequence, candidate.preparedAt,
      );
      insertNovelLifecycleOutboxRecord(this.database, {
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `rebase-resolved:${candidate.session.id}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.rebaseResolved,
        novelId: candidate.session.novelId,
        conversationId: candidate.session.ownerConversationId,
        occurredAt: candidate.preparedAt,
        payload: {
          sourceDraftSessionId: candidate.sourceDraftSessionId,
          conflictedCandidateDraftSessionId: candidate.conflictedCandidateDraftSessionId,
          resolvedCandidateDraftSessionId: candidate.session.id,
          candidateBaseRevision: candidate.session.baseRevision,
          effectiveOperationCount: candidate.operationCount,
        },
      });
      this.database.exec("COMMIT");
      this.logger.info("novel_resolved_candidate_store.created", {
        sourceDraftSessionId: candidate.sourceDraftSessionId,
        conflictedCandidateDraftSessionId: candidate.conflictedCandidateDraftSessionId,
        resolvedCandidateDraftSessionId: candidate.session.id,
        operationCount: candidate.operationCount,
      });
    } catch {
      try { this.database.exec("ROLLBACK"); } catch {}
      const existing = this.database.prepare(
        `${SELECT} WHERE novel_id = ? AND conflicted_candidate_draft_session_id = ?`,
      ).get(this.novelId, candidate.conflictedCandidateDraftSessionId) as Row | undefined;
      if (existing !== undefined) {
        throw new NovelRebaseCandidateIdentityConflictError(
          candidate.conflictedCandidateDraftSessionId,
          captureNovelDraftSessionId(existing.resolved_candidate_draft_session_id),
        );
      }
      throw invalid(this.workspaceId, this.novelId);
    }
  }

  async getResolvedCandidate(
    novelId: NovelId,
    resolvedCandidateDraftSessionId: NovelDraftSessionId,
  ): Promise<NovelResolvedRebaseCandidate | undefined> {
    this.assertIdentity(novelId);
    const row = this.database.prepare(
      `${SELECT} WHERE novel_id = ? AND resolved_candidate_draft_session_id = ?`,
    ).get(this.novelId, captureNovelDraftSessionId(resolvedCandidateDraftSessionId)) as Row | undefined;
    return row === undefined ? undefined : captureRow(row);
  }

  async listResolvedCandidates(novelId: NovelId): Promise<readonly NovelResolvedRebaseCandidate[]> {
    this.assertIdentity(novelId);
    return Object.freeze((this.database.prepare(
      `${SELECT} WHERE novel_id = ? ORDER BY prepared_at, resolved_candidate_draft_session_id`,
    ).all(this.novelId) as unknown as Row[]).map(captureRow));
  }

  async promoteResolvedCandidate(
    candidateInput: NovelResolvedRebaseCandidate,
    promotedAtInput: NovelTimestamp,
  ): Promise<NovelResolvedRebasePromotionResult> {
    this.assertOpen();
    const candidate = captureNovelResolvedRebaseCandidate(candidateInput);
    this.assertIdentity(candidate.session.novelId);
    const promotedAt = captureNovelTimestamp(promotedAtInput);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const registered = this.database.prepare(
        `${SELECT} WHERE novel_id = ? AND resolved_candidate_draft_session_id = ?`,
      ).get(this.novelId, candidate.session.id) as Row | undefined;
      if (registered === undefined || !matchesCandidate(registered, candidate)) {
        throw invalid(this.workspaceId, this.novelId);
      }
      if (registered.promoted_at !== null) {
        const promotion = this.readPromotion(
          candidate,
          captureNovelTimestamp(registered.promoted_at),
        );
        this.database.exec("COMMIT");
        return Object.freeze({ status: "duplicate", promotion });
      }
      const source = this.database.prepare(
        `UPDATE novel_draft_sessions
         SET status = 'conflicted', updated_at = ?, terminal_at = NULL
         WHERE novel_id = ? AND id = ? AND owner_conversation_id = ?
           AND status IN ('active', 'awaiting-approval', 'rebasing', 'conflicted')`,
      ).run(
        promotedAt,
        this.novelId,
        candidate.sourceDraftSessionId,
        candidate.session.ownerConversationId,
      );
      if (Number(source.changes) !== 1) {
        throw invalid(this.workspaceId, this.novelId);
      }
      this.database.prepare(
        `INSERT INTO novel_draft_sessions(
           id, novel_id, owner_conversation_id, base_revision, status,
           staging_key, created_at, updated_at, terminal_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
      ).run(
        candidate.session.id,
        this.novelId,
        candidate.session.ownerConversationId,
        candidate.session.baseRevision,
        candidate.session.id,
        candidate.session.createdAt,
        promotedAt,
      );
      const marked = this.database.prepare(
        `UPDATE novel_resolved_rebase_candidates SET promoted_at = ?
         WHERE novel_id = ? AND resolved_candidate_draft_session_id = ?
           AND promoted_at IS NULL`,
      ).run(promotedAt, this.novelId, candidate.session.id);
      if (Number(marked.changes) !== 1) {
        throw invalid(this.workspaceId, this.novelId);
      }
      const promotion = this.readPromotion(candidate, promotedAt);
      insertNovelLifecycleOutboxRecord(this.database, {
        recordVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
        eventId: `rebase-promoted:${candidate.session.id}`,
        eventType: NOVEL_LIFECYCLE_EVENT_TYPE.rebasePromoted,
        novelId: candidate.session.novelId,
        conversationId: candidate.session.ownerConversationId,
        occurredAt: promotedAt,
        payload: {
          sourceDraftSessionId: candidate.sourceDraftSessionId,
          resolvedCandidateDraftSessionId: candidate.session.id,
          baseRevision: candidate.session.baseRevision,
        },
      });
      this.database.exec("COMMIT");
      return Object.freeze({ status: "promoted", promotion });
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async removeResolvedCandidate(novelId: NovelId, id: NovelDraftSessionId): Promise<void> {
    this.assertIdentity(novelId);
    this.database.prepare(
      "DELETE FROM novel_resolved_rebase_candidates WHERE novel_id = ? AND resolved_candidate_draft_session_id = ?",
    ).run(this.novelId, captureNovelDraftSessionId(id));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private readPromotion(
    candidate: NovelResolvedRebaseCandidate,
    promotedAtInput: NovelTimestamp,
  ) {
    const promotedAt = captureNovelTimestamp(promotedAtInput);
    const row = this.database.prepare(
      `SELECT id, novel_id, owner_conversation_id, base_revision, status,
              created_at, updated_at, terminal_at
       FROM novel_draft_sessions WHERE novel_id = ? AND id = ?`,
    ).get(this.novelId, candidate.session.id) as
      | {
          id: string;
          novel_id: string;
          owner_conversation_id: string;
          base_revision: string;
          status: string;
          created_at: string;
          updated_at: string;
          terminal_at: string | null;
        }
      | undefined;
    const source = this.database.prepare(
      "SELECT status FROM novel_draft_sessions WHERE novel_id = ? AND id = ?",
    ).get(this.novelId, candidate.sourceDraftSessionId) as
      | { status: string }
      | undefined;
    if (
      row === undefined ||
      row.id !== candidate.session.id ||
      row.novel_id !== this.novelId ||
      row.owner_conversation_id !== candidate.session.ownerConversationId ||
      row.base_revision !== candidate.session.baseRevision ||
      row.status !== NOVEL_DRAFT_SESSION_STATUS.active ||
      row.terminal_at !== null ||
      source?.status !== NOVEL_DRAFT_SESSION_STATUS.conflicted
    ) {
      throw invalid(this.workspaceId, this.novelId);
    }
    return captureNovelResolvedRebasePromotion({
      sourceDraftSessionId: candidate.sourceDraftSessionId,
      resolvedCandidateDraftSessionId: candidate.session.id,
      session: captureNovelDraftSession({
        id: captureNovelDraftSessionId(row.id),
        novelId: captureNovelId(row.novel_id),
        ownerConversationId: captureNovelConversationId(
          row.owner_conversation_id,
        ),
        baseRevision: captureNovelRevision(row.base_revision),
        status: NOVEL_DRAFT_SESSION_STATUS.active,
        createdAt: captureNovelTimestamp(row.created_at),
        updatedAt: captureNovelTimestamp(row.updated_at),
      }),
      promotedAt,
    });
  }

  private assertIdentity(value: NovelId): void {
    this.assertOpen();
    if (captureNovelId(value) !== this.novelId) throw invalid(this.workspaceId, this.novelId);
  }
  private assertOpen(): void {
    if (this.closed) throw invalid(this.workspaceId, this.novelId);
  }
}

const SELECT = `SELECT resolved_candidate_draft_session_id, novel_id,
  source_draft_session_id, conflicted_candidate_draft_session_id,
  owner_conversation_id, candidate_base_revision, resolution_plan_digest,
  operation_count, last_operation_sequence, prepared_at, promoted_at
  FROM novel_resolved_rebase_candidates`;

function matchesCandidate(row: Row, candidate: NovelResolvedRebaseCandidate): boolean {
  return row.source_draft_session_id === candidate.sourceDraftSessionId &&
    row.conflicted_candidate_draft_session_id === candidate.conflictedCandidateDraftSessionId &&
    row.owner_conversation_id === candidate.session.ownerConversationId &&
    row.candidate_base_revision === candidate.session.baseRevision &&
    row.resolution_plan_digest === candidate.resolutionPlanDigest &&
    row.operation_count === candidate.operationCount &&
    row.last_operation_sequence === candidate.lastOperationSequence &&
    row.prepared_at === candidate.preparedAt;
}

function captureRow(row: Row): NovelResolvedRebaseCandidate {
  return captureNovelResolvedRebaseCandidate({
    sourceDraftSessionId: captureNovelDraftSessionId(row.source_draft_session_id),
    conflictedCandidateDraftSessionId: captureNovelDraftSessionId(row.conflicted_candidate_draft_session_id),
    resolutionPlanDigest: row.resolution_plan_digest as NovelResolvedRebaseCandidate["resolutionPlanDigest"],
    session: {
      id: captureNovelDraftSessionId(row.resolved_candidate_draft_session_id),
      novelId: captureNovelId(row.novel_id),
      ownerConversationId: captureNovelConversationId(row.owner_conversation_id),
      baseRevision: captureNovelRevision(row.candidate_base_revision),
      status: "rebasing",
      createdAt: captureNovelTimestamp(row.prepared_at),
      updatedAt: captureNovelTimestamp(row.prepared_at),
    },
    operationCount: row.operation_count,
    lastOperationSequence: row.last_operation_sequence,
    preparedAt: captureNovelTimestamp(row.prepared_at),
  });
}

function invalid(workspaceId: string, novelId: NovelId): NovelDatabaseError {
  return new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure, workspaceId, novelId);
}
function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
